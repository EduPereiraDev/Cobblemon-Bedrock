// Worker dos retratos: recebe lotes (um por espécie), renderiza e devolve os PNGs.
import { parentPort, workerData } from "node:worker_threads";
import { clearCaches, renderSpecs } from "./job.ts";
import type { RenderSpec } from "./job.ts";

const cacheDir: string | undefined = workerData?.cacheDir;
parentPort!.on("message", (msg: { batch: number; specs: RenderSpec[] } | null) => {
	if (!msg) {
		process.exit(0);
		return;
	}
	const outputs = renderSpecs(msg.specs, cacheDir);
	clearCaches();
	// Sem lista de transferência: Buffers pequenos podem dividir o pool interno do Node.
	parentPort!.postMessage({ batch: msg.batch, outputs });
});
