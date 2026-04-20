import { describe, expect, it } from "vitest";
import {
  preparePythonAnalysis,
  pythonAnalysisTemplateIds,
  preparePythonAnalysisInputSchema,
} from "@/lib/python-analysis";

describe("python-analysis", () => {
  it("accepts each supported template id", () => {
    for (const templateId of pythonAnalysisTemplateIds) {
      const result = preparePythonAnalysis({
        templateId,
        dataPayload: [{ date: "2026-01-01", revenue: 1200 }],
        title: "Demo chart",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) continue;

      expect(result.value.status).toBe("python_analysis_ready");
      expect(result.value.analysisTemplateId).toBe(templateId);
      expect(result.value.safeMode).toBe(true);
      expect(typeof result.value.pythonCode).toBe("string");
      expect(result.value.pythonCode.length).toBeGreaterThan(50);
    }
  });

  it("normalizes title with zod trim", () => {
    const parsed = preparePythonAnalysisInputSchema.parse({
      templateId: "revenue_trend",
      dataPayload: [{ date: "2026-01-01", revenue: 1200 }],
      title: "  Quarterly Revenue  ",
    });

    expect(parsed.title).toBe("Quarterly Revenue");
  });

  it("rejects unknown template ids", () => {
    const result = preparePythonAnalysis({
      templateId: "unknown_template",
      dataPayload: [{ amount: 100 }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("INVALID_ANALYSIS_INPUT");
  });

  it("rejects empty payloads", () => {
    const result = preparePythonAnalysis({
      templateId: "revenue_trend",
      dataPayload: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("INVALID_ANALYSIS_INPUT");
  });

  it("rejects payloads larger than allowed limit", () => {
    const largePayload = Array.from({ length: 2001 }, (_, i) => ({ idx: i, value: i + 1 }));
    const result = preparePythonAnalysis({
      templateId: "platform_revenue_breakdown",
      dataPayload: largePayload,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe("INVALID_ANALYSIS_INPUT");
  });
});
