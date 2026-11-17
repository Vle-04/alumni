/** Refuses to run destructive test setup against anything but a database whose name ends in "_test". */
export function assertTestDatabase(url: string | undefined): string {
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) throw new Error(`Refusing to wipe database "${name}": test database names must end with "_test".`);
  return url;
}
