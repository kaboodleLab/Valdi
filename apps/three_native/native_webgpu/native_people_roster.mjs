// Project the WorldOS roster's wire snapshot into the native People lane.
// The service owns identity and presence; this module only chooses bundled
// bodies and arrival positions for their visual representation.
const BODIES = new Set(['ahmad', 'andrew', 'brian', 'matt', 'moritz', 'will', 'worker']);

export function projectPeopleRoster(snapshot) {
  if (snapshot?.type !== 'roster' || !Array.isArray(snapshot.members)) return null;
  const members = new Map();
  const present = snapshot.status?.state === 'online' && snapshot.status?.name !== 'off'
    ? snapshot.members : [];
  for (const person of present) {
    if (typeof person?.id !== 'string' || !person.id || person.id.length > 64) continue;
    if (person.id === snapshot.self?.id) continue;
    members.set(person.id, person);
  }
  if (typeof snapshot.self?.id === 'string' && snapshot.self.id &&
      snapshot.self.id.length <= 64) members.set(snapshot.self.id, snapshot.self);
  const rows = [];
  for (const person of [...members.values()].slice(0, 40)) {
    // The browser bridge stands remote roster members, then self. The shared
    // character world seats each new body on this golden-angle ring.
    const angle = rows.length * 2.399963;
    const slug = typeof person.character === 'string' ? person.character.toLowerCase() : '';
    rows.push({ id: person.id, name: person.id === snapshot.self?.id ? 'Me' :
      String(person.name || 'Someone').slice(0, 80),
    model: `person-${BODIES.has(slug) ? slug : 'worker'}`,
    x: Math.cos(angle) * 2.8, z: Math.sin(angle) * 2.8 });
  }
  if (snapshot.status?.name === 'off' && rows.length === 0) return null;
  return rows;
}
