const PYODIDE_INDEX_URL = "https://cdn.jsdelivr.net/pyodide/v0.27.5/full";
const ALLOWED_TEMPLATE_IDS = new Set([
  "revenue_trend",
  "discipline_distribution",
  "platform_revenue_breakdown",
]);

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

function isPrimitiveCell(value) {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid payload for Python analysis.");
  }

  const analysisTemplateId = payload.analysisTemplateId;
  const dataPayload = payload.dataPayload;
  const pythonCode = payload.pythonCode;
  const title = payload.title;

  if (typeof analysisTemplateId !== "string" || !ALLOWED_TEMPLATE_IDS.has(analysisTemplateId)) {
    throw new Error("Invalid Python analysis template.");
  }

  if (!Array.isArray(dataPayload) || dataPayload.length === 0 || dataPayload.length > 2000) {
    throw new Error("dataPayload must be an array with 1-2000 rows.");
  }

  const rowsAreValid = dataPayload.every((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return false;
    return Object.values(row).every((cell) => isPrimitiveCell(cell));
  });

  if (!rowsAreValid) {
    throw new Error("All rows in dataPayload must contain only primitive cell values.");
  }

  if (typeof pythonCode !== "string" || pythonCode.trim().length === 0) {
    throw new Error("pythonCode is required for analysis execution.");
  }

  return {
    analysisTemplateId,
    dataPayload,
    pythonCode,
    title: typeof title === "string" ? title : "",
  };
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
      await pyodide.loadPackage(["pandas", "matplotlib"]);
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
    const payload = validatePayload(raw);
    const pyodide = await ensurePyodide(requestId);

    postProgress(requestId, "Executing Python template...");

    pyodide.globals.set("data_payload", payload.dataPayload);
    pyodide.globals.set("title", payload.title);

    await pyodide.runPythonAsync(payload.pythonCode);

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

    if (!base64Data) {
      throw new Error("Python analysis did not produce an image.");
    }

    try {
      pyodide.globals.delete("data_payload");
      pyodide.globals.delete("title");
    } catch {
      // Non-critical cleanup failure.
    }

    self.postMessage({
      type: "result",
      requestId,
      imageDataUrl: `data:image/png;base64,${base64Data}`,
      runtimeMs: Date.now() - startedAt,
      rowCount: payload.dataPayload.length,
    });
  } catch (error) {
    self.postMessage({
      type: "error",
      requestId,
      error: toErrorMessage(error),
    });
  }
};
