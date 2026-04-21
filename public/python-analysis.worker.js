const PYODIDE_INDEX_URL = "https://cdn.jsdelivr.net/pyodide/v0.27.5/full";

let pyodideInstance = null;
let pyodideReadyPromise = null;

function toErrorMessage(error) {
  if (!error) return "Unknown Python worker error.";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function postProgress(requestId, message) {
  self.postMessage({
    type: "progress",
    requestId,
    message,
  });
}

async function ensurePyodide(requestId) {
  if (pyodideInstance) return pyodideInstance;

  if (!pyodideReadyPromise) {
    pyodideReadyPromise = (async () => {
      postProgress(requestId, "Loading Pyodide runtime...");
      self.importScripts(`${PYODIDE_INDEX_URL}/pyodide.js`);

      if (typeof self.loadPyodide !== "function") {
        throw new Error("loadPyodide was not loaded in worker context.");
      }

      const pyodide = await self.loadPyodide({ indexURL: PYODIDE_INDEX_URL });
      postProgress(requestId, "Loading Python scientific packages...");
      await pyodide.loadPackage(["pandas", "numpy", "matplotlib"]);
      await pyodide.runPythonAsync("import matplotlib\nmatplotlib.use('Agg')");
      return pyodide;
    })();
  }

  pyodideInstance = await pyodideReadyPromise;
  return pyodideInstance;
}

self.onmessage = async (event) => {
  const raw = event.data || {};
  const requestId = typeof raw.requestId === "string" ? raw.requestId : "unknown-request";
  const startedAt = Date.now();

  try {
    const pythonCode = raw.pythonCode;
    const dataPayload = raw.dataPayload || [];

    if (typeof pythonCode !== "string" || pythonCode.trim().length === 0) {
      throw new Error("pythonCode is required for analysis execution.");
    }

    const pyodide = await ensurePyodide(requestId);

    postProgress(requestId, "Executing Python code...");

    pyodide.globals.set("data_payload", dataPayload);
    
    // Set up stdout and stderr capturing
    let stdoutData = [];
    let stderrData = [];
    pyodide.setStdout({ batched: (msg) => stdoutData.push(msg) });
    pyodide.setStderr({ batched: (msg) => stderrData.push(msg) });

    await pyodide.runPythonAsync(pythonCode);

    // Try to get plot
    await pyodide.runPythonAsync(
      "import io\n" +
      "import base64\n" +
      "import matplotlib.pyplot as plt\n" +
      "_plot_buffer = io.BytesIO()\n" +
      "plt.savefig(_plot_buffer, format='png', dpi=150, bbox_inches='tight')\n" +
      "plt.close('all')\n" +
      "_plot_png_base64 = base64.b64encode(_plot_buffer.getvalue()).decode('utf-8')\n"
    );

    const base64Proxy = pyodide.globals.get("_plot_png_base64");
    const base64Data = typeof base64Proxy === "string" ? base64Proxy : String(base64Proxy || "");
    if (base64Proxy && typeof base64Proxy.destroy === "function") {
      base64Proxy.destroy();
    }

    // Only set imageDataUrl if it's not empty, it might just be the empty plot representation
    let imageDataUrl = null;
    // An empty plot usually has length < 200 or so, but let's just see if base64Data has content
    // Actually, an empty matplotlib plot saves as ~1-2kb. We will just check if there is data.
    if (base64Data && base64Data.length > 500) {
        imageDataUrl = `data:image/png;base64,${base64Data}`;
    }

    try {
      pyodide.globals.delete("data_payload");
    } catch {
      // Non-critical cleanup failure.
    }

    self.postMessage({
      type: "result",
      requestId,
      imageDataUrl,
      stdout: stdoutData.join('\n'),
      stderr: stderrData.join('\n'),
      runtimeMs: Date.now() - startedAt,
      rowCount: Array.isArray(dataPayload) ? dataPayload.length : 0,
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId,
      error: toErrorMessage(error),
    });
  }
};
