import { createApp } from '../server/index.mjs';

// Used by the supervised preview. The normal npm start command still binds to
// localhost by default. Production hosting uses the separate Worker adapter.
const server = createApp({ demo: process.env.DEMO_MODE === 'true' });
const port = Number(process.env.PORT || 4173);
server.listen(port, '0.0.0.0', () => console.log('London development preview ready on port ' + port));
const close = () => server.close(() => process.exit(0));
process.once('SIGTERM', close);
process.once('SIGINT', close);
