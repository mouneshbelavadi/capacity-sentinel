import csv
import math
from pathlib import Path
import re
from typing import Any
from pydantic import BaseModel

from backend.core.config import settings
from backend.core.logging import logger
from backend.repos.scope import Scope


class Document(BaseModel):
    doc_id: str
    title: str
    content: str
    category: str  # "runbook" | "incident" | "policy"
    tenant_id: str | None = None
    rack_id: str | None = None


def _tokenize(text: str) -> list[str]:
    return [w.lower() for w in re.findall(r"\b[a-zA-Z0-9_\-\.]{2,}\b", text)]


def _compute_tf(tokens: list[str]) -> dict[str, float]:
    freq: dict[str, float] = {}
    for t in tokens:
        freq[t] = freq.get(t, 0.0) + 1.0
    total = len(tokens) or 1
    return {t: count / total for t, count in freq.items()}


def _cosine_similarity(vec1: dict[str, float], vec2: dict[str, float]) -> float:
    common = set(vec1.keys()) & set(vec2.keys())
    if not common:
        return 0.0
    dot = sum(vec1[k] * vec2[k] for k in common)
    mag1 = math.sqrt(sum(v * v for v in vec1.values()))
    mag2 = math.sqrt(sum(v * v for v in vec2.values()))
    if mag1 == 0 or mag2 == 0:
        return 0.0
    return dot / (mag1 * mag2)


class KnowledgeCorpus:
    def __init__(self, runbook_path: str | None = None):
        self.runbook_path = Path(runbook_path or settings.RUNBOOK_PATH)
        self.documents: list[Document] = []
        self._load_corpus()

    def _load_corpus(self) -> None:
        self.documents.clear()

        # 1. Load hand-written runbook sections
        if self.runbook_path.exists():
            text = self.runbook_path.read_text(encoding="utf-8")
            sections = re.split(r"\n(?=##\s+)", text)
            for idx, sec in enumerate(sections):
                lines = sec.strip().split("\n")
                title = lines[0].replace("#", "").strip()
                content = "\n".join(lines[1:]).strip()
                if content:
                    doc_id = f"doc_runbook_{idx+1}"
                    if "ASHRAE" in title:
                        doc_id = "doc_runbook_ashrae"
                    elif "Baseline" in title:
                        doc_id = "doc_runbook_baselines"
                    elif "Action Whitelist" in title:
                        doc_id = "doc_runbook_actions"
                    elif "RFID" in title:
                        doc_id = "doc_runbook_rfid"

                    self.documents.append(
                        Document(
                            doc_id=doc_id,
                            title=title,
                            content=content,
                            category="runbook",
                            tenant_id=None,  # Global, non-tenant specific
                        )
                    )

        # 2. Load historical incidents from dataset if present, or add representative ones
        csv_path = Path("c:/Users/moune/Downloads/files (1)/events_ground_truth.csv")
        if not csv_path.exists():
            # Try workspace relative
            csv_path = Path(__file__).parent.parent.parent.parent / "data" / "events_ground_truth.csv"

        if csv_path.exists():
            try:
                with open(csv_path, "r", encoding="utf-8") as f:
                    reader = csv.DictReader(f)
                    for r in reader:
                        doc_id = f"inc_{r.get('event_id', '').replace('-', '_')}"
                        tenant_id = r.get("tenant_id") or None
                        if tenant_id == "":
                            tenant_id = None
                        rack_id = r.get("rack_id") or None
                        desc = r.get("description", "")
                        subtype = r.get("subtype", "")
                        content = f"Event {r.get('event_id')}: {desc}. Type: {subtype}. Metric: {r.get('metric')}. Rack: {rack_id}."
                        self.documents.append(
                            Document(
                                doc_id=doc_id,
                                title=f"Historical Incident: {r.get('event_id')} ({subtype})",
                                content=content,
                                category="incident",
                                tenant_id=tenant_id,
                                rack_id=rack_id,
                            )
                        )
            except Exception as e:
                logger.warning(f"Could not load incidents CSV: {e}")

        # Built-in fallback incidents to guarantee realistic multi-tenant RAG retrieval
        if not any(d.category == "incident" for d in self.documents):
            self.documents.extend(
                [
                    Document(
                        doc_id="inc_alpha_storage_01",
                        title="Incident Alpha: Storage Growth Excursion",
                        content="Tenant t-alpha storage reached capacity due to unpruned backup staging. Resolved by workload cleanup.",
                        category="incident",
                        tenant_id="t-alpha",
                        rack_id="rack-01",
                    ),
                    Document(
                        doc_id="inc_beta_power_step_01",
                        title="Incident Beta: Compute Step Load",
                        content="Tenant t-beta provisioned 2 additional slots on rack-01 causing localized temperature rise. Load was throttled.",
                        category="incident",
                        tenant_id="t-beta",
                        rack_id="rack-01",
                    ),
                    Document(
                        doc_id="inc_fan_bearing_wear_01",
                        title="Incident Rack 01: Exhaust Fan Vibration",
                        content="Node r1-n1 fan bearing degraded; RMS vibration rose to 3.5x baseline. Resolved via INSPECT_FAN and replacement.",
                        category="incident",
                        tenant_id=None,
                        rack_id="rack-01",
                    ),
                ]
            )

    def retrieve(
        self,
        query: str,
        scope: Scope,
        top_k: int = 3,
    ) -> list[Document]:
        """
        Retrieves relevant documents with strict Scope filtering.
        TENANT callers receive ONLY documents where tenant_id == caller's tenant_id OR tenant_id is None.
        Foreign tenant documents are NEVER retrieved.
        """
        # 1. Scope filter first (Rule: Scope first, retrieve second, prompt third)
        allowed_docs: list[Document] = []
        for d in self.documents:
            if scope.role == "TENANT":
                if d.tenant_id is not None and d.tenant_id != scope.tenant_id:
                    continue  # Strictly excluded!
            allowed_docs.append(d)

        if not allowed_docs:
            return []

        # 2. Similarity scoring via term cosine similarity
        q_tokens = _tokenize(query)
        q_vec = _compute_tf(q_tokens)

        scored: list[tuple[float, Document]] = []
        for doc in allowed_docs:
            doc_tokens = _tokenize(f"{doc.title} {doc.content}")
            doc_vec = _compute_tf(doc_tokens)
            sim = _cosine_similarity(q_vec, doc_vec)
            scored.append((sim, doc))

        # Sort descending by score
        scored.sort(key=lambda x: x[0], reverse=True)

        # Return top_k
        return [doc for score, doc in scored[:top_k]]


# Singleton knowledge corpus
rag_corpus = KnowledgeCorpus()

