import { useEffect, useId, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { Connection, Mood, Point, Track } from "../types";
import "./MusicMap.css";

export type MusicMapProps = {
  tracks: Track[];
  moods: Mood[];
  connections: Connection[];
  mode: "mood" | "sound" | "metrics";
  selectedId: string | null;
  currentTrackId: string | null;
  activeMoodId: string | null;
  pathTrackIds: string[];
  onSelect: (id: string) => void;
  onPlay: (id: string) => void;
  onPositionChange: (id: string, point: Point) => void;
};

type MapNode = { track: Track; point: Point; color: string };
type DragState = {
  kind: "pan" | "node";
  id?: string;
  clientX: number;
  clientY: number;
  start: Point;
  moved: boolean;
};

const WIDTH = 1000;
const HEIGHT = 650;
const PLOT = { x: 62, y: 74, width: 876, height: 490 };
const clamp = (value: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, value));

function hash(value: string) {
  let result = 2166136261;
  for (let i = 0; i < value.length; i += 1)
    result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return result >>> 0;
}

function random(value: string, salt: number) {
  return (hash(`${value}:${salt}`) % 10000) / 10000;
}

function toPlot(point: Point, keepInBounds = true): Point {
  return {
    x: PLOT.x + (keepInBounds ? clamp(point.x) : point.x) * PLOT.width,
    y: PLOT.y + (keepInBounds ? clamp(point.y) : point.y) * PLOT.height,
  };
}

function fromPlot(point: Point): Point {
  return {
    x: clamp((point.x - PLOT.x) / PLOT.width),
    y: clamp((point.y - PLOT.y) / PLOT.height),
  };
}

function moodPosition(
  track: Track,
  moods: Mood[],
): { point: Point; color: string } | null {
  const ratings = moods
    .map((mood) => ({ mood, score: track.moodRatings[mood.id] ?? 0 }))
    .filter(({ score }) => score > 0);
  if (!ratings.length) return null;
  const total = ratings.reduce((sum, item) => sum + item.score * item.score, 0);
  const x =
    ratings.reduce(
      (sum, item) => sum + item.mood.x * item.score * item.score,
      0,
    ) / total;
  const y =
    ratings.reduce(
      (sum, item) => sum + item.mood.y * item.score * item.score,
      0,
    ) / total;
  const strongest = [...ratings].sort((a, b) => b.score - a.score)[0];
  const angle = random(track.id, 1) * Math.PI * 2;
  const radius = 0.035 + random(track.id, 2) * 0.13;
  return {
    point: {
      x: clamp(x + Math.cos(angle) * radius, 0.035, 0.965),
      y: clamp(y + Math.sin(angle) * radius, 0.04, 0.96),
    },
    color: strongest.mood.color,
  };
}

function featurePosition(
  track: Track,
  mode: "sound" | "metrics",
): Point | null {
  if (track.analysisStatus !== "ready" || !track.features) return null;
  const { tempo, brightness, rms } = track.features;
  if (mode === "metrics") {
    if (tempo === null || brightness === null) return null;
    return { x: tempo / 240, y: 1 - brightness / 10000 };
  }
  if (brightness === null || rms === null) return null;
  // Fixed feature scales keep positions stable as filters and the library change.
  const t = tempo === null ? 0.5 : clamp(tempo / 240);
  const b = clamp(brightness / 10000);
  const r = clamp(rms / 0.5);
  return {
    x: clamp(0.08 + 0.84 * (0.66 * t + 0.34 * b), 0.035, 0.965),
    y: clamp(0.92 - 0.84 * (0.65 * r + 0.35 * b), 0.04, 0.96),
  };
}

function organicPath(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  salt: number,
): string {
  const points = Array.from({ length: 14 }, (_, index) => {
    const angle = (index / 14) * Math.PI * 2;
    const wave =
      1 +
      Math.sin(angle * 3 + salt) * 0.085 +
      Math.cos(angle * 5 + salt * 0.3) * 0.045;
    return {
      x: cx + Math.cos(angle) * rx * wave,
      y: cy + Math.sin(angle) * ry * wave,
    };
  });
  const mid = (a: Point, b: Point) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });
  const start = mid(points[points.length - 1], points[0]);
  let result = `M ${start.x} ${start.y}`;
  points.forEach((point, index) => {
    const next = mid(point, points[(index + 1) % points.length]);
    result += ` Q ${point.x} ${point.y} ${next.x} ${next.y}`;
  });
  return `${result} Z`;
}

function shorten(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

export function MusicMap({
  tracks,
  moods,
  connections,
  mode,
  selectedId,
  currentTrackId,
  activeMoodId,
  pathTrackIds,
  onSelect,
  onPlay,
  onPositionChange,
}: MusicMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<DragState | null>(null);
  const lastTap = useRef<{ id: string; time: number } | null>(null);
  const localPositionsRef = useRef<Record<string, Point>>({});
  const [localPositions, setLocalPositions] = useState<Record<string, Point>>(
    {},
  );
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
  const [dragging, setDragging] = useState(false);
  const rawId = useId().replace(/:/g, "");
  const patternId = `music-map-dots-${rawId}`;
  const clipId = `music-map-clip-${rawId}`;
  const arrowId = `music-map-arrow-${rawId}`;
  const descriptionId = `music-map-description-${rawId}`;
  const positionSnapshot = tracks
    .map(
      (track) =>
        `${track.id}:${track.position?.x ?? ""}:${track.position?.y ?? ""}`,
    )
    .join("|");

  useEffect(() => {
    setLocalPositions({});
    localPositionsRef.current = {};
  }, [positionSnapshot, mode]);

  const { nodes, unplaced } = useMemo(() => {
    const positioned: MapNode[] = [];
    const missing: Track[] = [];
    for (const track of tracks) {
      const moodResult = mode === "mood" ? moodPosition(track, moods) : null;
      const generated =
        mode === "mood" ? moodResult?.point : featurePosition(track, mode);
      // Manual arrangement is a separate user action and never fabricates a rating or feature.
      const override =
        mode === "metrics"
          ? null
          : (localPositions[track.id] ?? track.position);
      const point = generated ? (override ?? generated) : null;
      if (point)
        positioned.push({
          track,
          point: toPlot(point, mode !== "metrics"),
          color: moodResult?.color ?? track.color ?? "#1652bf",
        });
      else missing.push(track);
    }
    return { nodes: positioned, unplaced: missing };
  }, [tracks, moods, mode, localPositions]);

  const byId = useMemo(
    () => new Map(nodes.map((node) => [node.track.id, node])),
    [nodes],
  );
  const selected = byId.get(selectedId ?? "");
  const featuredIds = new Set(
    nodes
      .filter(
        (node) =>
          node.track.id !== selectedId && node.track.id !== currentTrackId,
      )
      .slice(0, 2)
      .map((node) => node.track.id),
  );
  const orderedPath = pathTrackIds
    .map((id) => byId.get(id))
    .filter((node): node is MapNode => Boolean(node));
  const visibleConnections = connections.filter(
    (connection) =>
      byId.has(connection.sourceId) && byId.has(connection.targetId),
  );
  const generatedConnections = useMemo(() => {
    if (mode !== "sound") return [];
    const pairs: { source: MapNode; target: MapNode }[] = [];
    const seen = new Set<string>();
    for (const source of nodes) {
      const a = source.track.features;
      if (!a || a.brightness === null || a.rms === null) continue;
      let best: MapNode | null = null;
      let bestDistance = Infinity;
      for (const target of nodes) {
        const b = target.track.features;
        if (target === source || !b || b.brightness === null || b.rms === null)
          continue;
        let distance =
          ((a.brightness - b.brightness) / 10000) ** 2 +
          ((a.rms - b.rms) / 0.5) ** 2;
        if (a.tempo !== null && b.tempo !== null)
          distance += ((a.tempo - b.tempo) / 240) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = target;
        }
      }
      if (best) {
        const pairId = [source.track.id, best.track.id].sort().join(":");
        if (!seen.has(pairId)) {
          pairs.push({ source, target: best });
          seen.add(pairId);
        }
      }
    }
    return pairs;
  }, [nodes, mode]);

  function svgPoint(clientX: number, clientY: number) {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return { x: clientX, y: clientY };
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    return point.matrixTransform(matrix.inverse());
  }

  function startPan(event: ReactPointerEvent<SVGSVGElement>) {
    if (
      mode === "metrics" ||
      event.button !== 0 ||
      (event.target as Element).closest("[data-map-node]")
    )
      return;
    const point = svgPoint(event.clientX, event.clientY);
    drag.current = {
      kind: "pan",
      clientX: point.x,
      clientY: point.y,
      start: { x: viewport.x, y: viewport.y },
      moved: false,
    };
    svgRef.current?.setPointerCapture(event.pointerId);
    setDragging(true);
  }

  function startNodeDrag(event: ReactPointerEvent<SVGGElement>, node: MapNode) {
    if (event.button !== 0) return;
    event.stopPropagation();
    onSelect(node.track.id);
    if (mode === "metrics") return;
    const point = svgPoint(event.clientX, event.clientY);
    drag.current = {
      kind: "node",
      id: node.track.id,
      clientX: point.x,
      clientY: point.y,
      start: node.point,
      moved: false,
    };
    svgRef.current?.setPointerCapture(event.pointerId);
  }

  function movePointer(event: ReactPointerEvent<SVGSVGElement>) {
    const state = drag.current;
    if (!state) return;
    const point = svgPoint(event.clientX, event.clientY);
    const dx = point.x - state.clientX;
    const dy = point.y - state.clientY;
    if (Math.hypot(dx, dy) > 3) state.moved = true;
    if (!state.moved) return;
    setDragging(true);
    if (state.kind === "pan") {
      setViewport((previous) => ({
        ...previous,
        x: clamp(state.start.x + dx, -WIDTH, WIDTH),
        y: clamp(state.start.y + dy, -HEIGHT, HEIGHT),
      }));
    } else if (state.id) {
      const next = {
        ...localPositionsRef.current,
        [state.id]: fromPlot({
          x: state.start.x + dx / viewport.scale,
          y: state.start.y + dy / viewport.scale,
        }),
      };
      localPositionsRef.current = next;
      setLocalPositions(next);
    }
  }

  function finishPointer(event: ReactPointerEvent<SVGSVGElement>) {
    const state = drag.current;
    if (state?.kind === "node" && state.id && state.moved) {
      const position = localPositionsRef.current[state.id];
      if (position) onPositionChange(state.id, position);
    } else if (
      state?.kind === "node" &&
      state.id &&
      event.type !== "pointercancel"
    ) {
      const now = Date.now();
      if (
        lastTap.current?.id === state.id &&
        now - lastTap.current.time < 350
      ) {
        onPlay(state.id);
        lastTap.current = null;
      } else lastTap.current = { id: state.id, time: now };
    }
    drag.current = null;
    setDragging(false);
    if (svgRef.current?.hasPointerCapture(event.pointerId))
      svgRef.current.releasePointerCapture(event.pointerId);
  }

  function zoom(factor: number) {
    if (mode === "metrics") return;
    setViewport((previous) => {
      const nextScale = clamp(previous.scale * factor, 0.65, 2.5);
      const ratio = nextScale / previous.scale;
      return {
        scale: nextScale,
        x: WIDTH / 2 - (WIDTH / 2 - previous.x) * ratio,
        y: HEIGHT / 2 - (HEIGHT / 2 - previous.y) * ratio,
      };
    });
  }

  function nodeKeyDown(event: KeyboardEvent<SVGGElement>, track: Track) {
    if (event.key === "Enter") {
      event.preventDefault();
      onSelect(track.id);
    }
    if (event.key === " ") {
      event.preventDefault();
      onPlay(track.id);
    }
  }

  const modeLabel =
    mode === "mood"
      ? "Your emotional landscape"
      : mode === "sound"
        ? "A study in sound"
        : "The measured view";
  const description =
    mode === "mood"
      ? "Positions follow your mood ratings. Drag to make it yours."
      : mode === "sound"
        ? "A baseline arrangement of tempo, brightness, and amplitude."
        : "Tempo and spectral brightness, measured from your audio.";
  const viewChanged =
    Math.abs(viewport.scale - 1) > 0.001 ||
    Math.abs(viewport.x) > 0.5 ||
    Math.abs(viewport.y) > 0.5;

  return (
    <section
      className={`music-map music-map--${mode}${dragging ? " music-map--dragging" : ""}`}
      aria-label={`${modeLabel} music map`}
    >
      <svg
        ref={svgRef}
        className="music-map-canvas"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        aria-label={`${modeLabel}. ${nodes.length} songs placed. Enter selects a song; space plays it. Use the track list as an alternative.`}
        aria-describedby={descriptionId}
        onPointerDown={startPan}
        onPointerMove={movePointer}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onWheel={(event) => {
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            zoom(event.deltaY < 0 ? 1.08 : 1 / 1.08);
          }
        }}
      >
        <desc id={descriptionId}>{description}</desc>
        <defs>
          <pattern
            id={patternId}
            x="0"
            y="0"
            width="24"
            height="24"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r="0.6" fill="#18334b" opacity="0.14" />
          </pattern>
          <clipPath id={clipId}>
            <rect x="17" y="24" width="966" height="567" rx="4" />
          </clipPath>
          <marker
            id={arrowId}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path
              d="M 1 1 L 9 5 L 1 9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
            />
          </marker>
        </defs>
        <rect
          className="music-map-grid"
          x="22"
          y="24"
          width="956"
          height="567"
          fill={`url(#${patternId})`}
        />
        <g clipPath={`url(#${clipId})`}>
          <g
            transform={
              mode === "metrics"
                ? undefined
                : `translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`
            }
          >
            {mode === "mood" &&
              moods.map((mood, index) => {
                const anchor = toPlot(mood);
                const isActive = !activeMoodId || activeMoodId === mood.id;
                return (
                  <g
                    className="music-map-neighborhood"
                    key={mood.id}
                    style={{ opacity: isActive ? 1 : 0.28 }}
                    aria-hidden="true"
                  >
                    {[1, 0.79, 0.59].map((size, level) => (
                      <path
                        key={level}
                        d={organicPath(
                          anchor.x,
                          anchor.y,
                          160 * size,
                          112 * size,
                          index + 1,
                        )}
                        fill={mood.color}
                        fillOpacity={level === 0 ? 0.035 : 0.02}
                        stroke={mood.color}
                        strokeOpacity={0.09 + level * 0.025}
                        strokeWidth="0.8"
                        strokeDasharray={level === 0 ? "2 4" : undefined}
                      />
                    ))}
                    <text
                      className="music-map-region-label"
                      x={anchor.x}
                      y={anchor.y + 54}
                      fill={mood.color}
                      textAnchor="middle"
                    >
                      {mood.label.toLowerCase()}
                    </text>
                  </g>
                );
              })}
            {mode === "sound" &&
              [
                {
                  x: 270,
                  y: 385,
                  rx: 180,
                  ry: 140,
                  color: "#4b8b72",
                  label: "soft edges",
                },
                {
                  x: 525,
                  y: 285,
                  rx: 210,
                  ry: 175,
                  color: "#1858c0",
                  label: "in between",
                },
                {
                  x: 780,
                  y: 185,
                  rx: 170,
                  ry: 125,
                  color: "#df4935",
                  label: "bright & bold",
                },
              ].map((region, index) => (
                <g
                  className="music-map-neighborhood"
                  key={region.label}
                  aria-hidden="true"
                >
                  {[1, 0.78, 0.57].map((size, level) => (
                    <path
                      key={level}
                      d={organicPath(
                        region.x,
                        region.y,
                        region.rx * size,
                        region.ry * size,
                        index + 2,
                      )}
                      fill={region.color}
                      fillOpacity="0.025"
                      stroke={region.color}
                      strokeOpacity="0.1"
                      strokeWidth="0.8"
                    />
                  ))}
                  <text
                    x={region.x}
                    y={region.y + 58}
                    textAnchor="middle"
                    fill={region.color}
                    className="music-map-region-label music-map-region-label--sound"
                  >
                    {region.label}
                  </text>
                </g>
              ))}
            {generatedConnections.map(({ source, target }) => (
              <path
                key={`generated-${source.track.id}-${target.track.id}`}
                className="music-map-connection music-map-connection--generated"
                d={`M ${source.point.x} ${source.point.y} Q ${(source.point.x + target.point.x) / 2 + 20} ${(source.point.y + target.point.y) / 2 - 20} ${target.point.x} ${target.point.y}`}
              >
                <title>
                  Closest measured-feature neighbor; not a personal rating
                </title>
              </path>
            ))}
            {visibleConnections.map((connection) => {
              const source = byId.get(connection.sourceId)!;
              const target = byId.get(connection.targetId)!;
              return (
                <path
                  key={connection.id}
                  className={`music-map-connection${connection.origin === "user" ? " music-map-connection--personal" : ""}`}
                  d={`M ${source.point.x} ${source.point.y} Q ${(source.point.x + target.point.x) / 2 + 18} ${(source.point.y + target.point.y) / 2 - 32} ${target.point.x} ${target.point.y}`}
                >
                  <title>
                    {connection.reason ||
                      (connection.origin === "user"
                        ? "Your connection"
                        : "Suggested connection")}
                  </title>
                </path>
              );
            })}
            {orderedPath.length > 1 && (
              <polyline
                className="music-map-session-path"
                points={orderedPath
                  .map((node) => `${node.point.x},${node.point.y}`)
                  .join(" ")}
                fill="none"
                markerEnd={`url(#${arrowId})`}
              >
                <title>TastePlay session route</title>
              </polyline>
            )}
            {nodes
              .filter((node) => node.track.id !== selectedId)
              .concat(selected ? [selected] : [])
              .map((node) => {
                const { track, point, color } = node;
                const isSelected = track.id === selectedId;
                const isCurrent = track.id === currentTrackId;
                const isHighlighted =
                  !activeMoodId || (track.moodRatings[activeMoodId] ?? 0) >= 3;
                const showLabel =
                  isSelected || isCurrent || featuredIds.has(track.id);
                const radius = isSelected
                  ? 11
                  : 5.5 + (track.enjoyment ?? 2) * 0.8;
                const labelWidth = Math.min(
                  186,
                  Math.max(
                    118,
                    Math.max(track.title.length, track.artist.length) * 6.2 +
                      20,
                  ),
                );
                const labelX = point.x > 750 ? -labelWidth - 18 : 18;
                const title = `${track.title} by ${track.artist}${track.enjoyment ? `, enjoyment ${track.enjoyment} out of 5` : ""}. Enter to select, space to play.`;
                return (
                  <g
                    key={track.id}
                    data-map-node={track.id}
                    className={`music-map-node${isSelected ? " music-map-node--selected" : ""}${isCurrent ? " music-map-node--current" : ""}`}
                    transform={`translate(${point.x} ${point.y})`}
                    style={
                      {
                        "--node-color": color,
                        opacity: isHighlighted ? 1 : 0.27,
                      } as CSSProperties
                    }
                    role="button"
                    tabIndex={0}
                    aria-label={title}
                    aria-pressed={isSelected}
                    onPointerDown={(event) => startNodeDrag(event, node)}
                    onClick={() => onSelect(track.id)}
                    onDoubleClick={() => {
                      if (mode === "metrics") onPlay(track.id);
                    }}
                    onKeyDown={(event) => nodeKeyDown(event, track)}
                  >
                    <title>{title}</title>
                    <circle className="music-map-node-hit" r="19" />
                    {(isSelected || isCurrent) && (
                      <circle
                        className="music-map-node-halo"
                        r={isSelected ? 17 : 15}
                      />
                    )}
                    <circle className="music-map-node-disc" r={radius} />
                    {(isSelected || isCurrent || hash(track.id) % 4 === 0) && (
                      <circle
                        className="music-map-node-center"
                        r={isSelected ? 3.6 : 2.3}
                      />
                    )}
                    {showLabel && (
                      <g
                        className={`music-map-node-label${!isSelected && !isCurrent ? " music-map-node-label--quiet" : ""}`}
                        transform={`translate(${labelX} ${isSelected || isCurrent ? -23 : -10})`}
                      >
                        <rect width={labelWidth} height="46" rx="4" />
                        <text x="10" y="18" className="music-map-track-title">
                          {shorten(track.title, 25)}
                        </text>
                        <text x="10" y="34" className="music-map-track-artist">
                          {shorten(track.artist, 26)}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}
            {orderedPath.map((node, index) => (
              <g
                key={`step-${node.track.id}`}
                className="music-map-path-step"
                transform={`translate(${node.point.x - 12} ${node.point.y - 18})`}
                aria-hidden="true"
              >
                <circle r="9" />
                <text y="3" textAnchor="middle">
                  {index + 1}
                </text>
              </g>
            ))}
          </g>
        </g>
        {mode === "metrics" && (
          <g className="music-map-axes" aria-hidden="true">
            <line
              x1={PLOT.x}
              y1={PLOT.y + PLOT.height + 20}
              x2={PLOT.x + PLOT.width}
              y2={PLOT.y + PLOT.height + 20}
            />
            <line
              x1={PLOT.x - 20}
              y1={PLOT.y}
              x2={PLOT.x - 20}
              y2={PLOT.y + PLOT.height}
            />
            {[0, 60, 120, 180, 240].map((value) => (
              <text
                key={value}
                x={PLOT.x + (value / 240) * PLOT.width}
                y={PLOT.y + PLOT.height + 39}
                textAnchor="middle"
              >
                {value}
              </text>
            ))}
            <text
              x={500}
              y={628}
              textAnchor="middle"
              className="music-map-axis-label"
            >
              TEMPO · BPM
            </text>
            <text
              transform="translate(19 320) rotate(-90)"
              textAnchor="middle"
              className="music-map-axis-label"
            >
              SPECTRAL BRIGHTNESS · HZ
            </text>
            <text x={PLOT.x - 27} y={PLOT.y + 4} textAnchor="end">
              10k
            </text>
            <text x={PLOT.x - 27} y={PLOT.y + PLOT.height} textAnchor="end">
              0
            </text>
          </g>
        )}
        {nodes.length === 0 && (
          <g className="music-map-empty" aria-hidden="true">
            <text x="500" y="288" textAnchor="middle">
              A little room to grow.
            </text>
            <text
              className="music-map-empty-detail"
              x="500"
              y="322"
              textAnchor="middle"
            >
              {mode === "mood"
                ? "Rate a song’s mood to give it a place on your map."
                : "Your sound map appears as audio analysis completes."}
            </text>
          </g>
        )}
      </svg>
      {mode !== "metrics" && (
        <div className="music-map-navigation">
          {viewChanged && (
            <button
              className="music-map-reset"
              type="button"
              onClick={() => setViewport({ x: 0, y: 0, scale: 1 })}
              aria-label="Reset map view"
              title="Reset view"
            >
              <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true">
                <path
                  d="M4 7a7 7 0 1 1-1 6M4 2v5h5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
            </button>
          )}
          <div className="music-map-tools" aria-label="Map zoom controls">
          <button
            type="button"
            onClick={() => zoom(1.2)}
            aria-label="Zoom in"
            disabled={viewport.scale >= 2.5}
          >
            +
          </button>
          <button
            type="button"
            onClick={() => zoom(1 / 1.2)}
            aria-label="Zoom out"
            disabled={viewport.scale <= 0.65}
          >
            −
          </button>
          </div>
        </div>
      )}
      {unplaced.length > 0 && (
        <div
          className="music-map-unplaced"
          aria-label="Tracks awaiting map placement"
        >
          <span className="music-map-unplaced-label">
            {mode === "mood" ? "Awaiting a mood" : "Awaiting analysis"}{" "}
            <span>{unplaced.length}</span>
          </span>
          <div className="music-map-unplaced-tracks">
            {unplaced.map((track) => (
              <button
                key={track.id}
                type="button"
                onClick={() => onSelect(track.id)}
                title={`${track.title} — ${mode === "mood" ? "add a mood rating to place this track" : track.analysisStatus}`}
              >
                <span style={{ background: track.color }} />
                {track.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export default MusicMap;
