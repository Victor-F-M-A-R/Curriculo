/**
 * Orthographic model of a six-bay distribution terminal.
 * Coordinates use X for the length of the building, Y for height and Z for depth.
 * The default camera is isometric. All equipment and markings share its projection.
 */
const BAY_IDS = ["D1", "D2", "D3", "D4", "D5", "D6"];
const CENTRES = [-105, -63, -21, 21, 63, 105];
const STATUS = {
  free: { label: "Livre", paint: "#a4cfb4", dark: "#52726a" },
  booked: { label: "Reservada", paint: "#efbc6d", dark: "#947044" },
  servicing: { label: "Em atendimento", paint: "#87bfd1", dark: "#416775" },
  unknown: { label: "Sem dados", paint: "#9bada4", dark: "#59635d" },
};
const DEFAULT_YAW = Math.PI / 4;
const PITCH = Math.asin(1 / Math.sqrt(3));
const MIN_YAW = (24 * Math.PI) / 180;
const MAX_YAW = (60 * Math.PI) / 180;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function makeProjection(width, height, yaw) {
  const c = Math.cos(yaw),
    s = Math.sin(yaw);
  const cp = Math.cos(PITCH),
    sp = Math.sin(PITCH);
  const raw = (x, y, z) => [x * c - z * s, (x * s + z * c) * sp - y * cp];
  const corners = [];
  for (const x of [-144, 144]) {
    for (const z of [-63, 78]) corners.push(raw(x, -5, z));
  }
  for (const x of [-128, 128]) {
    for (const z of [-57, 2]) corners.push(raw(x, 34, z));
  }
  const minX = Math.min(...corners.map((p) => p[0])),
    maxX = Math.max(...corners.map((p) => p[0]));
  const minY = Math.min(...corners.map((p) => p[1])),
    maxY = Math.max(...corners.map((p) => p[1]));
  const padX = width < 460 ? 11 : 22,
    padY = height < 270 ? 10 : 17;
  const scale = Math.min((width - 2 * padX) / (maxX - minX), (height - 2 * padY) / (maxY - minY));
  const cx = width / 2 - ((minX + maxX) * scale) / 2;
  const cy = height / 2 - ((minY + maxY) * scale) / 2;
  const project = (x, y, z) => {
    const [u, v] = raw(x, y, z);
    return [cx + scale * u, cy + scale * v];
  };
  return { project, scale };
}

function drawingContext(ctx, project, scale) {
  function path(points) {
    ctx.beginPath();
    points.forEach(([x, y, z], i) => {
      const [u, v] = project(x, y, z);
      if (i === 0) ctx.moveTo(u, v);
      else ctx.lineTo(u, v);
    });
  }
  function face(points, fill, edge) {
    path(points);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (edge) {
      ctx.strokeStyle = edge;
      ctx.lineWidth = 0.65;
      ctx.stroke();
    }
  }
  function line(points, color, size = 0.55) {
    path(points);
    ctx.lineWidth = Math.max(0.33, size * scale);
    ctx.strokeStyle = color;
    ctx.stroke();
  }
  function flat(x0, x1, z0, z1, y, color) {
    face(
      [
        [x0, y, z0],
        [x1, y, z0],
        [x1, y, z1],
        [x0, y, z1],
      ],
      color,
    );
  }
  function front(x0, x1, y0, y1, z, color) {
    face(
      [
        [x0, y0, z],
        [x1, y0, z],
        [x1, y1, z],
        [x0, y1, z],
      ],
      color,
    );
  }
  function end(z0, z1, y0, y1, x, color) {
    face(
      [
        [x, y0, z0],
        [x, y0, z1],
        [x, y1, z1],
        [x, y1, z0],
      ],
      color,
    );
  }
  function box(x0, x1, z0, z1, y0, y1, colors) {
    end(z0, z1, y0, y1, x1, colors.end);
    front(x0, x1, y0, y1, z1, colors.front);
    flat(x0, x1, z0, z1, y1, colors.top);
  }
  // Local coordinates define the lettering or round fitting on its physical plane.
  function onPlane(origin, axisU, axisV, paint) {
    const [ox, oy] = project(...origin);
    const [ux, uy] = project(...origin.map((v, i) => v + axisU[i]));
    const [vx, vy] = project(...origin.map((v, i) => v + axisV[i]));
    ctx.save();
    ctx.transform(ux - ox, uy - oy, vx - ox, vy - oy, ox, oy);
    paint(ctx);
    ctx.restore();
  }
  function text(origin, axisU, axisV, value, size, color, align = "left") {
    onPlane(origin, axisU, axisV, (c) => {
      c.fillStyle = color;
      c.textAlign = align;
      c.textBaseline = "middle";
      c.font = `700 ${size}px "Barlow", "Arial", sans-serif`;
      c.fillText(value, 0, 0);
    });
  }
  return { ctx, project, scale, face, line, flat, front, end, box, onPlane, text };
}

const asphalt = { end: "#444c49", front: "#555d58", top: "#737973" };
const concrete = { end: "#788175", front: "#9ba18f", top: "#b8b9a6" };
const lightMetal = { end: "#757e76", front: "#97a297", top: "#c3c9b8" };
const darkMetal = { end: "#2e3c3b", front: "#495855", top: "#66746a" };
const ochre = { end: "#92683b", front: "#c18d4f", top: "#e6b977" };

function paintGround(d, states) {
  const { ctx, face, box, flat, line, text } = d;
  // Draw a cast shadow before the terrain slab. The bevel is visible at the near edge.
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.64)";
  ctx.shadowBlur = 13;
  ctx.shadowOffsetY = 6;
  face(
    [
      [-144, -5, -63],
      [144, -5, -63],
      [144, -5, 78],
      [-144, -5, 78],
    ],
    "#1b2321",
  );
  ctx.restore();
  box(-144, 144, -63, 78, -4.8, 0, asphalt);
  flat(-142, 142, -61, 76, 0.12, "#828780");
  flat(-140, 140, -59, 75, 0.14, "#737b74");
  flat(-140, 140, 57, 75, 0.15, "#5d6760");
  // Asphalt grain and expansion joints stay fixed while the camera moves.
  for (let i = 0; i < 460; i++) {
    const x = -139 + ((i * 73) % 278) + (i % 5) / 5;
    const z = -58 + ((i * 97) % 132);
    const length = 0.35 + (i % 6) * 0.13;
    line(
      [
        [x, 0.19, z],
        [x + length, 0.19, z + 0.3],
      ],
      i % 2 ? "#ffffff12" : "#10292024",
      0.31,
    );
  }
  for (let x = -129; x <= 126; x += 42)
    line(
      [
        [x, 0.2, -58],
        [x, 0.2, 57],
      ],
      "#414d466b",
      0.41,
    );
  for (const z of [13, 37, 57])
    line(
      [
        [-137, 0.2, z],
        [137, 0.2, z],
      ],
      "#46514975",
      0.41,
    );
  flat(-139, 139, 70.7, 71.2, 0.23, "#b3b5a1");
  flat(-139, 139, 57.5, 58.1, 0.23, "#c7ab74");
  for (let x = -134; x <= 134; x += 15) flat(x, x + 6, 65.3, 65.8, 0.23, "#c5c7b3");
  for (const x of [-86, 12, 110]) {
    face(
      [
        [x, 0.23, 59.9],
        [x + 5, 0.23, 59.9],
        [x + 5, 0.23, 58.9],
        [x + 8, 0.23, 60.7],
        [x + 5, 0.23, 62.5],
        [x + 5, 0.23, 61.5],
        [x, 0.23, 61.5],
      ],
      "#d8d7bd",
    );
  }
  CENTRES.forEach((x, i) => {
    const { paint, dark } = STATUS[states[i]];
    flat(x - 17.3, x + 17.3, -4, 53, 0.23, "#7c837b");
    for (const dx of [-16.5, 16.5]) flat(x + dx - 0.28, x + dx + 0.28, -2.6, 50.3, 0.26, "#d2cdae");
    flat(x - 16.7, x - 11.2, 50.2, 50.8, 0.27, "#d2cdae");
    flat(x + 11.2, x + 16.7, 50.2, 50.8, 0.27, "#d2cdae");
    for (const dx of [-12.4, 12.4]) {
      flat(x + dx - 0.34, x + dx + 0.34, 4.5, 31, 0.27, "#d9ad63");
      flat(x + dx - 0.34, x + dx + 0.34, 32.7, 37.3, 0.27, "#d9ad63");
    }
    // Short coloured slab at the loading line matches the physical door beacon.
    flat(x - 10, x + 10, 0.6, 1.9, 0.28, dark);
    flat(x - 9.6, x + 9.6, 1.05, 1.45, 0.29, paint);
  });
  // Corner turn boxes and curb blocks.
  for (const x of [-136.5, 132]) {
    for (let z = 2; z < 47; z += 5.0) {
      face(
        [
          [x, 0.3, z + 1],
          [x + 3, 0.3, z - 1],
          [x + 3, 0.3, z + 1.2],
          [x, 0.3, z + 3.2],
        ],
        "#cfac6d",
      );
    }
  }
  for (let x = -135; x <= 137; x += 21) {
    box(x, x + 10.4, 73.8, 75.0, 0.2, 0.85, concrete);
  }
  text([-134, 0.31, 66.5], [1, 0, 0], [0, 0, 1], "VIA 01", 3.1, "#c2c4b4");
}

function paintRoof(d) {
  const { flat, box, line, onPlane, text } = d;
  box(-128.4, 128.4, -57.4, -5.1, 27.8, 29.4, darkMetal);
  flat(-127.6, 127.6, -56.5, -6, 29.42, "#818d80");
  for (let x = -125.7; x < 128; x += 3.8) {
    line(
      [
        [x, 29.46, -55.9],
        [x, 29.46, -6.4],
      ],
      "#526259",
      0.4,
    );
    line(
      [
        [x + 0.42, 29.47, -55.9],
        [x + 0.42, 29.47, -6.4],
      ],
      "#a6ad95",
      0.29,
    );
  }
  for (const z of [-49, -16])
    line(
      [
        [-126.7, 29.49, z],
        [126.7, 29.49, z],
      ],
      "#636f60",
      0.32,
    );
  // Alternating clerestories and HVAC skids.
  for (const x of [-102, -58, -14, 30, 74]) {
    box(x - 9, x + 9, -37, -27, 29.5, 30.7, darkMetal);
    flat(x - 8.5, x + 8.5, -36.6, -27.4, 30.72, "#a0b3ab");
    for (let k = -7.7; k < 8; k += 3.5) flat(x + k, x + k + 0.4, -36.5, -27.5, 30.75, "#606c62");
    line(
      [
        [x - 8.4, 30.78, -33.7],
        [x + 8.4, 30.78, -33.7],
      ],
      "#d3d9c8",
      0.36,
    );
    line(
      [
        [x - 8.4, 30.78, -33.0],
        [x + 8.4, 30.78, -33.0],
      ],
      "#778e84",
      0.32,
    );
  }
  for (const x of [-105, 6, 99]) {
    flat(x - 8, x + 8, -53.8, -43.4, 29.5, "#636f64");
    box(x - 7.2, x + 7.2, -54.3, -46.1, 29.5, 32.6, lightMetal);
    for (const dx of [-3.3, 3.3]) {
      onPlane([x + dx, 32.66, -50.1], [1, 0, 0], [0, 0, 1], (c) => {
        c.fillStyle = "#56685f";
        c.beginPath();
        c.arc(0, 0, 2.5, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = "#9eafa3";
        c.lineWidth = 0.28;
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
          c.beginPath();
          c.moveTo(0, 0);
          c.lineTo(2.1 * Math.cos(a), 2.1 * Math.sin(a));
          c.stroke();
        }
      });
    }
  }
  box(-129.1, 129.1, -57.8, -56.4, 28.8, 30.0, lightMetal);
  box(-129.1, 129.1, -6.4, -5.1, 28.8, 30.0, lightMetal);
  // Stencilled warehouse identifier on an unoccupied section of the metal roof.
  text([79, 29.56, -12.5], [1, 0, 0], [0, 0, 1], "DN / 01", 4.8, "#dae0c8");
}

function paintWarehouse(d, states) {
  const { box, line, front, end, text, face } = d;
  box(-128, 128, -57, -5, 0.1, 2.9, concrete);
  box(-127, 127, -56, -6, 2.9, 28.0, {
    end: "#47554f",
    front: "#5a6960",
    top: "#738173",
  });
  for (let x = -124; x < 127; x += 3.1) {
    line(
      [
        [x, 3, -5.96],
        [x, 27.8, -5.96],
      ],
      "#44554d",
      0.49,
    );
    line(
      [
        [x + 0.65, 3, -5.95],
        [x + 0.65, 27.8, -5.95],
      ],
      "#8d9781",
      0.28,
    );
  }
  for (let z = -54; z < -6; z += 2.7)
    line(
      [
        [127.04, 3, z],
        [127.04, 27.6, z],
      ],
      "#384740",
      0.45,
    );
  // High windows form a band on the right-hand gable.
  for (let z = -51; z < -10; z += 8.3) {
    end(z, z + 6.6, 16.3, 22.2, 127.1, "#223837");
    end(z + 0.4, z + 6.0, 16.8, 21.6, 127.2, "#82998a");
    line(
      [
        [127.25, 19.0, z + 0.4],
        [127.25, 19.0, z + 6.0],
      ],
      "#536b60",
      0.4,
    );
  }
  end(-23, -15, 3.0, 13.5, 127.2, "#303f38");
  end(-22.2, -15.8, 3.2, 12.8, 127.28, "#9ea794");
  for (const z of [-50, -44.4]) {
    line(
      [
        [127.32, 3.0, z],
        [127.32, 29.4, z],
      ],
      "#c2c7ae",
      0.56,
    );
  }
  for (let y = 4; y < 29; y += 1.6)
    line(
      [
        [127.35, y, -50],
        [127.35, y, -44.4],
      ],
      "#969f8e",
      0.41,
    );
  states.forEach((state, i) => {
    const x = CENTRES[i],
      ink = STATUS[state],
      active = state === "servicing";
    front(x - 14, x + 14, 2.8, 22.4, -5.85, "#38473f");
    front(x - 12.8, x + 12.8, 3.2, 21.6, -5.7, "#222e2b");
    front(x - 11.9, x + 11.9, active ? 10.7 : 3.3, 20.7, -5.6, active ? "#687871" : "#849086");
    const bottom = active ? 10.8 : 3.6;
    for (let y = bottom; y < 20.6; y += 1.09)
      line(
        [
          [x - 11.7, y, -5.45],
          [x + 11.7, y, -5.45],
        ],
        "#4e6158",
        0.31,
      );
    front(x - 11.2, x + 11.2, 14.1, 16.4, -5.38, "#536a60");
    for (const dx of [-7.2, 0, 7.2]) front(x + dx - 2.0, x + dx + 2.0, 14.4, 16.1, -5.3, "#b1c2ae");
    front(x - 4.7, x + 4.7, 22.6, 26.8, -5.35, "#2b3932");
    text(
      [x, 24.5, -5.28],
      [1, 0, 0],
      [0, -1, 0],
      String(i + 1).padStart(2, "0"),
      3.4,
      "#efe1b4",
      "center",
    );
    front(x + 14.4, x + 16.0, 14.9, 18.7, -5.35, "#26352e");
    front(x + 14.75, x + 15.65, 15.5, 18.15, -5.25, ink.paint);
    box(x - 13.4, x + 13.4, -5.1, -1.1, 0.2, 2.7, concrete);
    for (const dx of [-10.5, 10.5]) {
      box(x + dx - 0.7, x + dx + 0.7, -1.4, -0.25, 0.5, 3.5, darkMetal);
      box(x + dx - 0.53, x + dx + 0.53, 1.2, 2.35, 0.2, 4.15, ochre);
      front(x + dx - 0.56, x + dx + 0.56, 2.2, 2.8, 2.38, "#37443d");
    }
  });
  // Cantilevered steel canopy and the amber edge protection.
  for (let x = -126; x <= 126; x += 21) {
    face(
      [
        [x, 19.8, -5.0],
        [x, 23.2, 0.8],
        [x, 23.3, -5],
      ],
      "#33453b",
    );
  }
  box(-128.8, 128.8, -5.8, 1.5, 23.4, 24.2, darkMetal);
  front(-128.8, 128.8, 23.3, 24.15, 1.53, "#d9aa66");
  paintRoof(d);
}

function wheel(d, x, z) {
  d.onPlane([x, 2.25, z], [0, 0, 1], [0, 1, 0], (c) => {
    for (const [radius, color] of [
      [2.12, "#25312d"],
      [1.2, "#95a08e"],
      [0.64, "#56635a"],
    ]) {
      c.fillStyle = color;
      c.beginPath();
      c.arc(0, 0, radius, 0, Math.PI * 2);
      c.fill();
    }
  });
}

function paintTruck(d, x, state, index) {
  const { box, flat, front, end, line, face, text } = d;
  const parked = state === "booked",
    offset = parked ? 5.8 : 0;
  const tail = -0.7 + offset,
    shoulder = 20.0 + offset,
    nose = 29.0 + offset;
  const body = parked
    ? { end: "#778b86", front: "#899d92", top: "#c9d1bd" }
    : { end: "#697f85", front: "#82999b", top: "#c3d0c6" };
  const cab = parked ? ochre : { end: "#466d70", front: "#629499", top: "#93b8af" };
  face(
    [
      [x - 5.0, 0.34, tail - 0.7],
      [x + 8.5, 0.34, tail + 1.3],
      [x + 9.3, 0.34, nose + 2.2],
      [x - 4.5, 0.34, nose + 1.9],
    ],
    "#37483e66",
  );
  box(x - 4.7, x + 4.7, tail + 0.4, nose - 0.3, 1.6, 3.4, darkMetal);
  box(x - 6.1, x + 6.1, tail, shoulder, 4.1, 13.0, body);
  // Reefer rails, rain channel and company stencil.
  for (let z = tail + 1.1; z < shoulder - 0.2; z += 1.5) {
    line(
      [
        [x + 6.16, 4.7, z],
        [x + 6.16, 12.4, z],
      ],
      "#405759",
      0.31,
    );
  }
  end(tail + 0.7, shoulder - 0.6, 4.4, 5.1, x + 6.2, "#d2c18d");
  for (const dx of [-5.45, 5.45])
    flat(x + dx - 0.12, x + dx + 0.12, tail + 0.45, shoulder - 0.45, 13.03, "#8d9e95");
  for (let z = tail + 3; z < shoulder; z += 5.0)
    line(
      [
        [x - 5.6, 13.04, z],
        [x + 5.6, 13.04, z],
      ],
      "#a1b1a4",
      0.26,
    );
  box(x - 5.5, x + 5.5, shoulder + 0.8, nose, 2.8, 8.6, cab);
  box(x - 5.2, x + 5.2, shoulder + 0.95, nose - 1.4, 8.55, 10.2, cab);
  front(x - 4.9, x + 4.9, 6.9, 8.45, nose + 0.06, "#294745");
  front(x - 4.5, x + 4.3, 7.5, 8.19, nose + 0.1, "#87a8a0");
  end(shoulder + 2.4, nose - 1.2, 6.45, 8.6, x + 5.55, "#2a4643");
  end(shoulder + 2.9, nose - 1.8, 7.6, 8.2, x + 5.62, "#92afa5");
  front(x - 2.7, x + 2.7, 3.4, 5.3, nose + 0.09, "#364b42");
  for (const dx of [-4.1, 4.1]) front(x + dx - 0.85, x + dx + 0.85, 4.5, 5.3, nose + 0.13, "#f6ddb2");
  for (const z of [tail + 3.1, tail + 6.9, shoulder - 0.9, nose - 3]) wheel(d, x + 5.75, z);
  for (const dx of [-4.7, 4.7])
    flat(x + dx - 0.28, x + dx + 0.28, shoulder + 1.1, nose - 1.7, 10.24, "#b8c5ae");
  text([x + 6.25, 9.3, tail + 10], [0, 0, -1], [0, -1, 0], `N${index + 1}`, 2.3, "#dbe2cc", "center");
}

function paint(scene, width, height, yaw, states) {
  const { project, scale } = makeProjection(width, height, yaw);
  const d = drawingContext(scene, project, scale);
  scene.clearRect(0, 0, width, height);
  scene.lineJoin = "round";
  scene.lineCap = "round";
  paintGround(d, states);
  paintWarehouse(d, states);
  states.forEach((state, i) => {
    if (state === "booked" || state === "servicing") paintTruck(d, CENTRES[i], state, i);
  });
  return CENTRES.map((x) => project(x, 0.44, 47.2));
}

function control(label, symbol) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "dn-yard__control";
  button.setAttribute("aria-label", label);
  button.title = label;
  const icon = document.createElement("span");
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = symbol;
  button.append(icon);
  return button;
}

/**
 * Mount a yard in an empty host. onSelect receives the stable dock ID, e.g. "D2".
 * Unknown/unavailable docks remain visible with an explicit neutral state.
 */
export function mountYard(container, { docks = [], onSelect, selectedId = null } = {}) {
  const root = document.createElement("div");
  root.className = "dn-yard";
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", "Maquete interativa do terminal de cargas");
  const canvas = document.createElement("canvas");
  canvas.className = "dn-yard__surface";
  canvas.setAttribute("aria-hidden", "true");
  const pins = document.createElement("div");
  pins.className = "dn-yard__pins";
  pins.setAttribute("role", "group");
  pins.setAttribute("aria-label", "Selecionar doca");
  const controls = document.createElement("div");
  controls.className = "dn-yard__controls";
  controls.setAttribute("role", "group");
  controls.setAttribute("aria-label", "Orientação da maquete");
  const left = control("Girar maquete à esquerda", "↶");
  const right = control("Girar maquete à direita", "↷");
  controls.append(left, right);
  root.append(canvas, pins, controls);
  container.append(root);
  const ctx = canvas.getContext("2d");
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const listeners = new AbortController();
  const eventOptions = { signal: listeners.signal };
  let selection = selectedId,
    items = [],
    states = [];
  let yaw = DEFAULT_YAW,
    targetYaw = DEFAULT_YAW,
    drag = null,
    frame = 0;
  let width = 0,
    height = 0,
    destroyed = false;
  let anchors = [];
  const markers = BAY_IDS.map((id, i) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dn-yard__pin";
    button.textContent = id;
    button.addEventListener("click", () => select(i), eventOptions);
    button.addEventListener(
      "keydown",
      (event) => {
        let next;
        if (event.key === "Home") next = 0;
        else if (event.key === "End") next = BAY_IDS.length - 1;
        else if (event.key === "ArrowRight") next = (i + 1) % BAY_IDS.length;
        else if (event.key === "ArrowLeft") next = (i + BAY_IDS.length - 1) % BAY_IDS.length;
        else return;
        event.preventDefault();
        const direction = event.key === "ArrowLeft" || event.key === "End" ? -1 : 1;
        for (let n = 0; n < BAY_IDS.length; n++) {
          if (!markers[next].disabled) {
            markers[next].focus();
            break;
          }
          next = (next + direction + BAY_IDS.length) % BAY_IDS.length;
        }
      },
      eventOptions,
    );
    pins.append(button);
    return button;
  });

  function describePins() {
    markers.forEach((button, i) => {
      const item = items[i],
        id = BAY_IDS[i],
        state = states[i];
      const title = item?.name || `Doca ${i + 1}`;
      const label = `${id} · ${title} · ${STATUS[state].label}`;
      button.setAttribute("aria-label", label);
      button.setAttribute("aria-pressed", String(id === selection));
      button.disabled = !item;
      button.dataset.state = state;
      button.title = label;
    });
  }
  function select(i) {
    if (!items[i]) return;
    selection = BAY_IDS[i];
    describePins();
    onSelect?.(selection);
  }
  function draw() {
    if (destroyed || !ctx || !width || !height) return;
    anchors = paint(ctx, width, height, yaw, states);
    markers.forEach((button, i) => {
      button.style.left = `${anchors[i][0]}px`;
      button.style.top = `${anchors[i][1]}px`;
    });
  }
  function resize() {
    const bounds = root.getBoundingClientRect();
    width = Math.round(bounds.width);
    height = Math.round(bounds.height);
    if (!width || !height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
    draw();
  }
  function move() {
    frame = 0;
    const difference = targetYaw - yaw;
    yaw = motion.matches || Math.abs(difference) < 0.001 ? targetYaw : yaw + difference * 0.26;
    draw();
    if (yaw !== targetYaw) frame = requestAnimationFrame(move);
  }
  function rotate(newYaw) {
    targetYaw = clamp(newYaw, MIN_YAW, MAX_YAW);
    left.disabled = targetYaw <= MIN_YAW + 1e-6;
    right.disabled = targetYaw >= MAX_YAW - 1e-6;
    if (!frame) frame = requestAnimationFrame(move);
  }
  left.addEventListener("click", () => rotate(targetYaw - Math.PI / 18), eventOptions);
  right.addEventListener("click", () => rotate(targetYaw + Math.PI / 18), eventOptions);
  canvas.addEventListener(
    "pointerdown",
    (event) => {
      if (!event.isPrimary || event.button !== 0) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw: targetYaw, moved: false };
      canvas.setPointerCapture(event.pointerId);
    },
    eventOptions,
  );
  canvas.addEventListener(
    "pointermove",
    (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x,
        dy = event.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) > 5 && Math.abs(dx) > Math.abs(dy)) drag.moved = true;
      if (drag.moved) {
        root.classList.add("dn-yard--dragging");
        rotate(drag.yaw + dx * 0.006);
      }
    },
    eventOptions,
  );
  function release(event) {
    if (!drag || drag.id !== event.pointerId) return;
    if (!drag.moved && event.type === "pointerup" && Math.abs(event.clientY - drag.y) < 6) {
      const rect = canvas.getBoundingClientRect();
      // Select the truck or its lane as well as the explicit keyboard-accessible pin.
      const { project } = makeProjection(width, height, yaw);
      const px = event.clientX - rect.left,
        py = event.clientY - rect.top;
      for (let i = CENTRES.length - 1; i >= 0; i--) {
        const x = CENTRES[i];
        const insideLane = insidePolygon(px, py, [
          project(x - 16.4, 0.4, 1),
          project(x + 16.4, 0.4, 1),
          project(x + 16.4, 0.4, 51),
          project(x - 16.4, 0.4, 51),
        ]);
        if (insideLane) {
          select(i);
          break;
        }
      }
    }
    drag = null;
    root.classList.remove("dn-yard--dragging");
  }
  canvas.addEventListener("pointerup", release, eventOptions);
  canvas.addEventListener("pointercancel", release, eventOptions);
  const observer = new ResizeObserver(resize);
  observer.observe(root);
  function update(nextDocks, nextSelection = selection) {
    const index = new Map((nextDocks || []).map((item) => [item.id, item]));
    items = BAY_IDS.map((id) => index.get(id));
    states = items.map((item) => (Object.hasOwn(STATUS, item?.status) ? item.status : "unknown"));
    selection = nextSelection;
    describePins();
    draw();
  }
  update(docks, selectedId);
  resize();
  return {
    update,
    destroy() {
      destroyed = true;
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      listeners.abort();
      root.remove();
    },
  };
}

function insidePolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [a, b] = points[i],
      [c, d] = points[j];
    if (b > y !== d > y && x < ((c - a) * (y - b)) / (d - b) + a) inside = !inside;
  }
  return inside;
}
