from typing import Any
import numpy as np
from sklearn.ensemble import IsolationForest

MIN_SAMPLES_FOR_ANOMALY = 20


class AnomalyDetector:
    def __init__(self, node_id: str):
        self.node_id = node_id
        self.model: IsolationForest | None = None
        self.fitted = False

    def fit_baseline(self, feature_matrix: np.ndarray) -> bool:
        if len(feature_matrix) < MIN_SAMPLES_FOR_ANOMALY:
            return False
        try:
            self.model = IsolationForest(
                n_estimators=50,
                contamination=0.05,
                random_state=42,
            )
            self.model.fit(feature_matrix)
            self.fitted = True
            return True
        except Exception:
            self.fitted = False
            return False

    def score_sample(self, vector: list[float]) -> tuple[bool, float | None]:
        """
        Returns (is_anomaly, anomaly_score).
        If not fitted due to insufficient baseline samples, returns (False, None).
        """
        if not self.fitted or self.model is None:
            return False, None

        X = np.array(vector).reshape(1, -1)
        pred = self.model.predict(X)[0]  # -1 for anomaly, 1 for inlier
        score = float(self.model.decision_function(X)[0])
        is_anomaly = bool(pred == -1)
        return is_anomaly, round(score, 3)

