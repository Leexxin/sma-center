export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.SMA_CENTER_SELF_HOSTED === "1"
  ) {
    const { startSampling } = await import("./lib/sampling");
    startSampling();
  }
}
