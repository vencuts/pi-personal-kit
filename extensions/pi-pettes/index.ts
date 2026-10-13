import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { TUI } from "@mariozechner/pi-tui";
import { Text } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";

// --- Types ---

interface PetDef {
  art: string[][]; // [line][frame] - 2 lines of ascii art
  artWidth: number;
}

interface PetState extends PetDef {
  pos: number;
  eating: boolean;
}

interface Food {
  x: number;
  ttl: number;
  landed: boolean;
}
interface Dropping {
  x: number;
  ttl: number;
}

// --- Pet definitions ---

const petDefs: PetDef[] = [
  {
    art: [
      [" /\\_/\\ ", " /\\_/\\ ", " /|_/\\ ", " /\\_|\\ ", " /\\_/\\ "],
      ["( -.- )", "( o.o )", "( o.- )", "( -.o )", "( ^.^ )"],
    ],
    artWidth: 7,
  },
  {
    art: [
      [" .--. ", " .--. ", " .--. ", " .--. "],
      ["( o_o)", "(o_o )", "( O_O)", "( -_-)"],
    ],
    artWidth: 6,
  },
  {
    art: [
      ["       ", "       ", "       ", "       "],
      ["><((°> ", " ><((°>", "<°))>< ", " <°))><"],
    ],
    artWidth: 7,
  },
];

// --- State ---

let petStates: PetState[] = [];
let food: Food[] = [];
let droppings: Dropping[] = [];
let frame = 0;
let interval: ReturnType<typeof setInterval> | undefined;
let trackWidth = 80;

// --- Helpers ---

function homePos(index: number, artWidth: number): number {
  const spacing = Math.floor(trackWidth / (petDefs.length + 1));
  return spacing * (index + 1) - Math.floor(artWidth / 2);
}

function clampPos(pos: number, artWidth: number): number {
  return Math.max(0, Math.min(trackWidth - artWidth, pos));
}

// --- Init ---

function initPets() {
  food = [];
  droppings = [];
  petStates = petDefs.map((def, i) => ({
    ...def,
    pos: homePos(i, def.artWidth),
    eating: false,
  }));
}

// --- Simulation ---

function tick() {
  frame++;

  droppings = droppings.filter((d) => --d.ttl > 0);
  food = food.filter((f) => --f.ttl > 0);
  for (const f of food) if (!f.landed) f.landed = true;

  const landedFood = food.filter((f) => f.landed);

  for (let i = 0; i < petStates.length; i++) {
    const pet = petStates[i];
    pet.eating = false;

    if (landedFood.length > 0) {
      const mouthX = pet.pos + pet.artWidth;
      const nearest = landedFood.reduce((a, b) => (Math.abs(a.x - mouthX) < Math.abs(b.x - mouthX) ? a : b));
      const eatPos = clampPos(nearest.x - pet.artWidth, pet.artWidth);

      // Move every other tick for slower approach
      if (frame % 2 === 0) {
        if (pet.pos < eatPos) pet.pos++;
        else if (pet.pos > eatPos) pet.pos--;
      }

      if (pet.pos === eatPos) {
        pet.eating = true;
        droppings.push({ x: Math.max(0, pet.pos - 1), ttl: 12 });
        landedFood.splice(landedFood.indexOf(nearest), 1);
        food.splice(food.indexOf(nearest), 1);
      }
    } else {
      // Drift home every 3rd tick
      const home = homePos(i, pet.artWidth);
      if (frame % 3 === 0) {
        if (pet.pos < home) pet.pos++;
        else if (pet.pos > home) pet.pos--;
      }
    }

    pet.pos = clampPos(pet.pos, pet.artWidth);
  }
}

// --- Rendering ---

function render(theme: Theme, width: number): string {
  const top = new Array(width).fill(" ");
  const bot = new Array(width).fill(" ");

  for (const d of droppings) {
    if (d.x >= 0 && d.x < width) {
      bot[d.x] = d.ttl > 8 ? "o" : d.ttl > 4 ? "_" : ".";
    }
  }

  for (const f of food) {
    if (f.x >= 0 && f.x < width) {
      (f.landed ? bot : top)[f.x] = "*";
    }
  }

  for (const pet of petStates) {
    const artFrame = pet.eating ? pet.art[0].length - 1 : frame % (pet.art[0].length - 1);
    for (let line = 0; line < 2; line++) {
      const buf = line === 0 ? top : bot;
      const artLine = pet.art[line][artFrame];
      for (let c = 0; c < artLine.length; c++) {
        const x = pet.pos + c;
        if (x >= 0 && x < width && artLine[c] !== " ") {
          buf[x] = artLine[c];
        }
      }
    }
  }

  const topStr = top.join("");
  if (topStr.trim()) {
    return theme.fg("muted", topStr) + "\n" + theme.fg("muted", bot.join(""));
  }
  return theme.fg("muted", bot.join(""));
}

// --- Feeding ---

function feedPets(inputTokens: number) {
  const count = inputTokens > 0 ? Math.min(8, Math.max(1, Math.round(inputTokens / 3000))) : 0;
  for (let i = 0; i < count; i++) {
    food.push({ x: Math.floor(Math.random() * trackWidth), ttl: 25, landed: false });
  }
}

// --- Widget ---

function applyWidget(ctx: ExtensionContext) {
  if (!ctx.hasUI) return;
  if (interval) clearInterval(interval);

  const update = () => {
    tick();
    ctx.ui.setWidget("pets", (tui: TUI, theme: Theme) => {
      const newWidth = tui.terminal.columns || 80;
      if (newWidth !== trackWidth) {
        trackWidth = newWidth;
        initPets();
      }
      return new Text(render(theme, trackWidth), 0, 0);
    });
  };

  update();
  interval = setInterval(update, 600);
}

// --- Extension entry point ---

export default function petsExtension(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    initPets();
    applyWidget(ctx);
  });

  pi.on("session_switch", (_event, ctx) => {
    initPets();
    applyWidget(ctx);
  });

  pi.on("turn_end", (event) => {
    const msg = event.message as any;
    if (msg?.usage) feedPets(msg.usage.input || 0);
  });

  pi.on("session_shutdown", () => {
    if (interval) clearInterval(interval);
  });
}
