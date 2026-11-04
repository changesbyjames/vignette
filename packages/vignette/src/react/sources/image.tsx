import type { ReactNode } from "react";

import type { Image } from "../../core/sources/image.js";
import { useAsset } from "../assets.js";
import type { ReactSourcePlugin, ReactSourceViewProps } from "../plugin.js";

/** `<Image>` as an `<img>` of the downloaded asset; suspends until it is downloaded. */
export const ImageView: ReactSourcePlugin<typeof Image> = {
  kind: "image",
  View: ImageSource,
};

function ImageSource({ source }: ReactSourceViewProps<typeof Image>): ReactNode {
  const src = useAsset(source.props.src);
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      style={{ display: "block", width: "100%", height: "100%" }}
    />
  );
}
