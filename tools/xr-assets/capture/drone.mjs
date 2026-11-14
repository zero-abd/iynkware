// Drone engine adapter (figures/engine/drone.js): not written yet.
const matches = (item) => /^drones\//.test(item);
const create = () => ({
  engine: 'drone',
  async setup(page) { throw new Error(`${page.item}: the drone adapter is not written yet`); },
});
export default { matches, create };
