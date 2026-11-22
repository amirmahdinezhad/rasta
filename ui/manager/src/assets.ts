const images = import.meta.glob("../../../bin/manager/icons/*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
export const appLogo = (id: string) =>
  images[`../../../bin/manager/icons/${id}.png`];
