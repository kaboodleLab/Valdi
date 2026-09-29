// Project the WorldOS roster's wire snapshot into the native People lane.
// The service owns identity and presence; this module only chooses bundled
// bodies and stable positions for their visual representation.
const BODIES = new Set(['ahmad', 'andrew', 'brian', 'matt', 'moritz', 'will', 'worker']);
const SLOTS = Array.from({ length: 40 }, (_, index) => {
  const ring = index < 8 ? 0 : index < 24 ? 1 : 2;
  const within = index - [0, 8, 24][ring];
  const count = [8, 16, 16][ring];
  const angle = 2 * Math.PI * (within / count + ring * .0375);
  const radius = [1.65, 2.7, 3.75][ring];
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
});

function slotFor(id, used) {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  for (let n = 0; n < SLOTS.length; n++) {
    const index = ((hash >>> 0) + n) % SLOTS.length;
    if (!used.has(index)) { used.add(index); return SLOTS[index]; }
  }
  return null;
}

export function projectPeopleRoster(snapshot) {
  if (snapshot?.type !== 'roster' || !Array.isArray(snapshot.members)) return null;
  const members = new Map();
  const present = snapshot.status?.state === 'online' && snapshot.status?.name !== 'off'
    ? snapshot.members : [];
  for (const person of [...present, snapshot.self]) {
    if (typeof person?.id !== 'string' || !person.id || person.id.length > 64) continue;
    members.set(person.id, person);
  }
  const used = new Set();
  const rows = [];
  for (const person of [...members.values()].sort((a, b) => a.id.localeCompare(b.id)).slice(0, 40)) {
    const slot = slotFor(person.id, used);
    if (!slot) break;
    const slug = typeof person.character === 'string' ? person.character.toLowerCase() : '';
    rows.push({ id: person.id, name: person.id === snapshot.self?.id ? 'Me' :
      String(person.name || 'Someone').slice(0, 80),
    model: `person-${BODIES.has(slug) ? slug : 'worker'}`, ...slot });
  }
  if (snapshot.status?.name === 'off' && rows.length === 0) return null;
  return rows;
}
