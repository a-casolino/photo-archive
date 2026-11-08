/** Modello InsightFace usato: impronte di modelli diversi non si confrontano. */
export const FACE_MODEL_ID = "buffalo_l";

/** I due file del pacchetto buffalo_l che servono. */
export const MODEL_FILES = { detector: "det_10g.onnx", recognizer: "w600k_r50.onnx" } as const;
