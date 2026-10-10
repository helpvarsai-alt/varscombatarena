import * as React from "react";

/**
 * True while a touch (coarse-pointer) device is held upright — the signal to
 * ask the player to rotate. Desktop windows are never gated, no matter how
 * narrow, because a portrait browser window is a normal way to browse.
 */
export function useNeedsLandscape() {
  const [needs, setNeeds] = React.useState(false);

  React.useEffect(() => {
    const coarse = window.matchMedia("(pointer: coarse)");
    const update = () =>
      setNeeds(coarse.matches && window.innerHeight > window.innerWidth);

    update();
    coarse.addEventListener("change", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      coarse.removeEventListener("change", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return needs;
}
