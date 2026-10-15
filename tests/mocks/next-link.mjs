import { createElement } from "react";

export default function Link({ href, children, ...rest }) {
  return createElement("a", { ...rest, href: String(href) }, children);
}
