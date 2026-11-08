import "server-only";
import path from "node:path";
import { access } from "node:fs/promises";
import sharp from "sharp";
import type { InferenceSession } from "onnxruntime-node";
import { FACE_MODEL_ID, MODEL_FILES } from "./constants";
import { normalize } from "./embedding";
import {
  ARCFACE_SIZE,
  ARCFACE_TEMPLATE,
  decodeScrfd,
  detectorInput,
  estimateSimilarity,
  letterbox,
  recognizerInput,
  warpSimilarity,
  type Detection,
} from "./geometry";

/*
 * Motore dei volti: InsightFace "buffalo_l" su ONNX Runtime (solo CPU).
 *   det_10g.onnx    SCRFD-10GF, trova i volti e 5 punti di riferimento
 *   w600k_r50.onnx  ArcFace ResNet-50, impronta di 512 numeri
 * I modelli non stanno nel repository: li scarica `npm run volti -- --scarica-modelli`.
 * Licenza dei modelli: solo uso non commerciale (l'archivio è personale).
 */

export { FACE_MODEL_ID, MODEL_FILES };

export interface FaceResult extends Detection {
  embedding: Float32Array;
}

export interface AnalyzedImage {
  width: number;
  height: number;
  faces: FaceResult[];
}

export interface EngineOptions {
  modelDir: string;
  /** Thread di calcolo: pochi, la VPS ospita anche altri siti. */
  threads: number;
  /** Lato del quadrato in cui il rilevatore guarda l'immagine. */
  detSize: number;
  /** Lato minimo del volto, in pixel dell'immagine analizzata. */
  minSize: number;
  /** Punteggio minimo del rilevatore (0..1). */
  minScore: number;
}

export interface FaceEngine {
  analyze(image: Buffer): Promise<AnalyzedImage>;
  release(): Promise<void>;
}

export async function modelsPresent(modelDir: string): Promise<boolean> {
  try {
    await Promise.all(Object.values(MODEL_FILES).map((f) => access(path.join(modelDir, f))));
    return true;
  } catch {
    return false;
  }
}

export async function createFaceEngine(opts: EngineOptions): Promise<FaceEngine> {
  if (!(await modelsPresent(opts.modelDir))) {
    throw new Error(
      `Modelli dei volti non trovati in ${path.resolve(opts.modelDir)}. Scaricali con: npm run volti -- --scarica-modelli`,
    );
  }
  // Caricato solo qui: il modulo nativo serve al programma dei volti, non al sito.
  const ort = await import("onnxruntime-node");
  const sessionOptions: InferenceSession.SessionOptions = {
    executionProviders: ["cpu"],
    intraOpNumThreads: opts.threads,
    interOpNumThreads: 1,
    graphOptimizationLevel: "all",
  };
  const det = await ort.InferenceSession.create(path.join(opts.modelDir, MODEL_FILES.detector), sessionOptions);
  const rec = await ort.InferenceSession.create(path.join(opts.modelDir, MODEL_FILES.recognizer), sessionOptions);
  if (det.outputNames.length !== 9) {
    throw new Error(`Rilevatore inatteso: ${det.outputNames.length} uscite invece di 9.`);
  }
  // sharp non deve usare tutti i core.
  sharp.concurrency(opts.threads);

  async function detect(image: Buffer, width: number, height: number): Promise<Detection[]> {
    const size = opts.detSize;
    const lb = letterbox(width, height, size);
    const small = await sharp(image).rotate().resize(lb.width, lb.height, { fit: "fill" }).removeAlpha().raw().toBuffer();
    const input = new ort.Tensor("float32", detectorInput(small, lb, size), [1, 3, size, size]);
    const out = await det.run({ [det.inputNames[0]]: input });
    const data = det.outputNames.map((n) => out[n].data as Float32Array);
    return decodeScrfd({ scores: data.slice(0, 3), boxes: data.slice(3, 6), kps: data.slice(6, 9) }, size, lb.scale, opts.minScore);
  }

  async function embed(rgb: Uint8Array, width: number, height: number, kps: number[]): Promise<Float32Array> {
    const t = estimateSimilarity(kps, ARCFACE_TEMPLATE);
    const aligned = warpSimilarity(rgb, width, height, t, ARCFACE_SIZE);
    const input = new ort.Tensor("float32", recognizerInput(aligned), [1, 3, ARCFACE_SIZE, ARCFACE_SIZE]);
    const out = await rec.run({ [rec.inputNames[0]]: input });
    return normalize(out[rec.outputNames[0]].data as Float32Array);
  }

  return {
    async analyze(image) {
      // .rotate() applica l'orientamento EXIF (le anteprime dell'import sono già dritte).
      const { data, info } = await sharp(image).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const rgb = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      const dets = (await detect(image, info.width, info.height)).filter(
        (d) => Math.min(d.box.x2 - d.box.x1, d.box.y2 - d.box.y1) >= opts.minSize,
      );
      const faces: FaceResult[] = [];
      for (const d of dets) faces.push({ ...d, embedding: await embed(rgb, info.width, info.height, d.kps) });
      return { width: info.width, height: info.height, faces };
    },
    async release() {
      await det.release();
      await rec.release();
    },
  };
}
