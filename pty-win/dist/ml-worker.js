import { parentPort } from "worker_threads";
let ort = null;
let session = null;
let sessionPath = "";
try {
    ort = await import("onnxruntime-node");
}
catch {
    // onnxruntime-node not installed — ML inference unavailable
    parentPort.on("message", ({ id }) => {
        parentPort.postMessage({ id, label: null, confidence: null, error: "onnxruntime-node not installed" });
    });
}
if (ort) {
    const ortRef = ort;
    parentPort.on("message", async ({ id, modelPath, lines }) => {
        try {
            if (!session || sessionPath !== modelPath) {
                session = await ortRef.InferenceSession.create(modelPath);
                sessionPath = modelPath;
            }
            const text = lines.join("\n");
            const inputTensor = new ortRef.Tensor("string", [text], [1, 1]);
            const result = await session.run({ string_input: inputTensor });
            const label = result["output_label"].data[0];
            const probs = result["output_probability"].data[0];
            const confidence = probs["busy"];
            parentPort.postMessage({ id, label, confidence, error: null });
        }
        catch (err) {
            parentPort.postMessage({ id, label: null, confidence: null, error: String(err) });
        }
    });
}
//# sourceMappingURL=ml-worker.js.map