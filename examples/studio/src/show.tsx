/** @jsxImportSource react */
import { asset, layerId, sceneId, sourceId, type LayoutStyle } from "@cbj/vignette-core";
import { View } from "@cbj/vignette-frame";
import { MoqSource } from "@cbj/vignette-moq/react";
import { Broadcast, ImageSource, Layer, Scene, Sources } from "@cbj/vignette";
import { useEffect, useState, type ReactElement } from "react";

import { sanctuaryClock } from "./clock.frame.js";
import { tile } from "./composition-layout.js";
import { animalDisclaimer } from "./disclaimer.frame.js";
import { sanctuaryLinks } from "./sanctuary-links.frame.js";
import { Slot } from "./slot.js";
import { testingBanner } from "./testing-banner.frame.js";

const MOQ_URL =
  "https://moq.conservation.stream/james?jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6Im1vcS1yZWxheS10ZXN0aW5nLTc4MzY1NjQ4YTBhZjBjZjUifQ.eyJyb290IjoiIiwicHV0IjoiIiwiZ2V0IjoiIiwiaWF0IjoxNzM1Njg5NjAwLCJleHAiOjI1MzQwMjMwMDc5OX0.e3_wGTTpIX3oac2pitLiu9RVBvja3Na05yhpchX8h-E";
const CAMERA_SIZE = { width: 1280, height: 720 } as const;

const CAMERAS: readonly {
  readonly id: string;
  readonly label: string;
  readonly audio?: boolean;
  readonly broadcast: string;
}[] = [
  { id: "marmosets", label: "Appa & Momo (Marmoset)", broadcast: "marm2.hang" },
  { id: "wolf-hybrids", label: "Awa & Akela (Wolf Hybrid)", broadcast: "wolf.hang" },
  {
    id: "serval",
    label: "Kasi (Serval) Temporary Enclosure",
    audio: true,
    broadcast: "serval.hang",
  },
  { id: "emus", label: "Stompy & Nolie (Emu)", broadcast: "emu.hang" },
  { id: "parrots", label: "Mia (Parrot)", broadcast: "parrot.hang" },
  { id: "georgie", label: "Georgie (Frog)", broadcast: "georgie.hang" },
];

const SLOTS: readonly {
  readonly size: { readonly width: number; readonly height: number };
  readonly style: LayoutStyle;
  readonly hero?: boolean;
}[] = [
  {
    size: { width: 640, height: 360 },
    style: tile(0, 0, 640, 360),
  },
  {
    size: { width: 640, height: 360 },
    style: tile(0, 360, 640, 360),
  },
  {
    size: { width: 1280, height: 720 },
    style: tile(640, 0, 1280, 720),
    hero: true,
  },
  {
    size: { width: 640, height: 360 },
    style: tile(0, 720, 640, 360),
  },
  {
    size: { width: 640, height: 360 },
    style: tile(640, 720, 640, 360),
  },
  {
    size: { width: 640, height: 360 },
    style: tile(1280, 720, 640, 360),
  },
];

export function Show(): ReactElement {
  const [cameraOrder, setCameraOrder] = useState(CAMERAS);

  useEffect(() => {
    const timer = setInterval(() => {
      setCameraOrder((current) => {
        const next = current
          .map((camera) => ({ camera, order: Math.random() }))
          .toSorted((left, right) => left.order - right.order)
          .map(({ camera }) => camera);

        if (!next.every((camera, index) => camera.id === current[index]?.id)) return next;
        const [first, ...rest] = next;
        return first === undefined ? next : [...rest, first];
      });
    }, 5000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  return (
    <Broadcast>
      <Sources>
        {CAMERAS.map((camera) => (
          <MoqSource
            key={camera.id}
            id={sourceId(`camera.${camera.id}`)}
            url={MOQ_URL}
            broadcast={camera.broadcast}
            size={CAMERA_SIZE}
            audio={camera.audio ?? false}
            quality="auto"
            disableWhenHidden={false}
          />
        ))}
        <ImageSource
          id={sourceId("overlay.six-camera-border")}
          asset={asset("streamborder6cam.png")}
          size={{ width: 1920, height: 1080 }}
        />
      </Sources>

      <Scene id={sceneId("main")} label="Alveus six-camera view">
        {cameraOrder.map((camera, index) => {
          const slot = SLOTS[index];
          if (slot === undefined) throw new Error(`Missing camera slot ${String(index)}.`);
          return (
            <Slot
              key={camera.id}
              id={camera.id}
              cameraSourceId={sourceId(`camera.${camera.id}`)}
              label={camera.label}
              size={slot.size}
              style={slot.style}
              {...(slot.hero === undefined ? {} : { hero: slot.hero })}
            />
          );
        })}

        <Layer
          id={layerId("overlay.six-camera-border.layer")}
          sourceId={sourceId("overlay.six-camera-border")}
          fit="fill"
          style={tile(0, 0, 1920, 1080)}
        />

        <View
          id="overlay.sanctuary-clock"
          source={sanctuaryClock}
          params={{}}
          viewport={{ width: 440, height: 150 }}
          style={tile(1466, 10, 440, 150)}
        />
        <View
          id="overlay.sanctuary-links"
          source={sanctuaryLinks}
          params={{}}
          viewport={{ width: 390, height: 120 }}
          style={tile(0, 960, 390, 120)}
        />
        <View
          id="overlay.animal-disclaimer"
          source={animalDisclaimer}
          params={{}}
          viewport={{ width: 760, height: 80 }}
          style={tile(1160, 1000, 760, 80)}
        />
        <View
          id="overlay.testing-banner"
          source={testingBanner}
          params={{}}
          viewport={{ width: 1200, height: 140 }}
          style={tile(360, 470, 1200, 140)}
        />
      </Scene>
    </Broadcast>
  );
}
