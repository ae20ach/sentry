export async function invokeProvidesCallback(
  fn: jest.ProvidesCallback,
  thisArg: unknown
) {
  await (fn as (this: unknown) => unknown).call(thisArg);
}

export function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
