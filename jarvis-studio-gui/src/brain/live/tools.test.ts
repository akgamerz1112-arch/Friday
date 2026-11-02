import { describe, expect, it, vi } from "vitest";
import { createToolRunner } from "./tools";

const call = (name: string, args: Record<string, unknown> = {}, id = "1") => ({ id, name, args });

describe("live tool runner", () => {
  it("runs an allowed tool and returns its real result", async () => {
    const run = vi.fn().mockResolvedValue({ ok: true, summary: "Torch on." });
    const out = await createToolRunner(run)([call("device_control", { action: "flashlight_on" })]);
    expect(run).toHaveBeenCalledWith("device_control", { action: "flashlight_on" });
    expect(out[0].response).toEqual({ ok: true, result: "Torch on." });
  });

  it("reports a failure as a failure", async () => {
    const run = vi.fn().mockResolvedValue({ ok: false, summary: "Couldn't find that app." });
    const out = await createToolRunner(run)([call("open_app", { target: "zzz" })]);
    expect(out[0].response.ok).toBe(false);
  });

  it("refuses tools outside the list (phone_task, shell, ...)", async () => {
    const run = vi.fn();
    const out = await createToolRunner(run)([call("phone_task", { goal: "x" }), call("run_command")]);
    expect(run).not.toHaveBeenCalled();
    expect(out.every((o) => o.response.ok === false)).toBe(true);
  });

  it("makes the model confirm before calling or messaging someone", async () => {
    let t = 1_000;
    const run = vi.fn().mockResolvedValue({ ok: true, summary: "Calling Mummy." });
    const runner = createToolRunner(run, () => t);
    const args = { to: "Mummy" };
    expect((await runner([call("call_contact", args)]))[0].response.done).toBe(false); // first: NOT DONE
    t += 500;
    expect((await runner([call("call_contact", args)]))[0].response.ok).toBe(false); // too soon: the model, not the user
    expect(run).not.toHaveBeenCalled();
    t += 5_000;
    expect((await runner([call("call_contact", args)]))[0].response.ok).toBe(true); // after the user said yes
    expect(run).toHaveBeenCalledTimes(1);
    t += 6_000;
    expect((await runner([call("call_contact", args)]))[0].response.done).toBe(false); // asks again next time
  });

  it("a thrown error becomes a failed result, not a crash", async () => {
    const run = vi.fn().mockRejectedValue(new Error("boom"));
    const out = await createToolRunner(run)([call("get_time")]);
    expect(out[0].response).toEqual({ ok: false, error: "boom" });
  });
});
