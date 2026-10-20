import { useEffect, useState } from "react";

export interface Route {
  path: string;
  params: URLSearchParams;
}

function parse(): Route {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const [path = "/", query = ""] = raw.split("?");
  return { path, params: new URLSearchParams(query) };
}

/** Minimal hash router: works on static hosting with no server rewrites. */
export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function navigate(path: string, params?: Record<string, string>): void {
  const q = params ? `?${new URLSearchParams(params).toString()}` : "";
  window.location.hash = `${path}${q}`;
}

export function href(path: string, params?: Record<string, string>): string {
  const q = params ? `?${new URLSearchParams(params).toString()}` : "";
  return `#${path}${q}`;
}
