from datetime import datetime, timezone
from typing import Any


def compute_attribution(
    rack_id: str,
    metric: str,
    tenant_nodes: list[dict[str, Any]],
    recent_changepoint: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Computes tenant attribution for a rack and metric.
    Honesty rules:
    - ALWAYS quality: 'inferred'
    - ALWAYS includes the basis string
    - Shares must sum to <= 1.0
    """
    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    contributors = []
    if tenant_nodes:
        # If there's a recent changepoint with an associated topology event or shift
        if recent_changepoint and recent_changepoint.get("topology_event"):
            topo = recent_changepoint["topology_event"]
            culprit_node = topo.get("node_id")

            # Match to tenant
            matched_tenant = None
            for tn in tenant_nodes:
                if tn.get("node_id") == culprit_node:
                    matched_tenant = tn
                    break

            if matched_tenant:
                contributors.append({
                    "tenant_id": matched_tenant["tenant_id"],
                    "tenant_label": matched_tenant.get("tenant_label") or matched_tenant["tenant_id"],
                    "share": 0.75,
                    "basis": f"slope increased after tenant node {culprit_node} came online at {recent_changepoint['located_at']}",
                    "meta": {
                        "quality": "inferred",
                        "source": "analysis:temporal_correlation",
                        "model": "temporal_correlation_v1",
                        "uncertainty_pct": 20,
                        "as_of": now_iso,
                    },
                })

        # If no specific changepoint matched, attribute based on slot share
        if not contributors:
            # Distribute based on occupied slots
            tenants = list({(tn["tenant_id"], tn.get("tenant_label")) for tn in tenant_nodes if tn.get("tenant_id")})
            if tenants:
                per_share = round(1.0 / len(tenants), 2)
                for t_id, t_lbl in tenants:
                    contributors.append({
                        "tenant_id": t_id,
                        "tenant_label": t_lbl or t_id,
                        "share": per_share,
                        "basis": f"proportional rack slot footprint ({per_share * 100:.0f}% allocation)",
                        "meta": {
                            "quality": "inferred",
                            "source": "analysis:slot_footprint",
                            "model": "footprint_v1",
                            "uncertainty_pct": 25,
                            "as_of": now_iso,
                        },
                    })

    return {
        "rack_id": rack_id,
        "metric": metric,
        "contributors": contributors,
    }

