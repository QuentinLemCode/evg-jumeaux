/**
 * The roster (spec 0002).
 *
 * This list is the whole user database. There is no sign-up: adding someone to
 * the weekend means adding a line here and re-running `npm run db:seed`.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ BEFORE THE PARTY, DO THIS:                                              │
 * │                                                                         │
 * │   1. Replace the names, ids and avatars below with the real guests.     │
 * │   2. For each of them, pick a 6-digit PIN and run:                      │
 * │        npm run hash-pin 482915                                          │
 * │   3. Paste the printed hash as their `pinHash`.                          │
 * │   4. Send each person their own PIN privately. Never commit the PINs.    │
 * │                                                                         │
 * │ Every hash below is currently the shared development PIN. Seeding      │
 * │ refuses to run with those hashes when NODE_ENV=production, so the app  │
 * │ cannot accidentally go live with a PIN everybody knows.                 │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * `id` is a permanent identifier: matches and points reference it forever.
 * Never reuse an id for a different person.
 */

export const DEV_PIN = '123456';

export type SeedUser = {
  id: string;
  name: string;
  role: 'admin' | 'user';
  avatar: string;
  pinHash: string;
};

export const seedUsers: SeedUser[] = [
  {"id":"quentin","name":"Quentin","role":"admin","avatar":"🐙","pinHash":"$2b$12$n7xSrv6vtgwbxQm3tOKokOX5C4thX2MdaGE41BWBlFrKctZreKolG"},
  {"id":"pablo","name":"Pablo","role":"admin","avatar":"🐯","pinHash":"$2b$12$d8Gjs1bZeh.jpAOSc3L6Yu/RhMCFsuKVUDQgIAMemkPegmRy8SALK"},
  {"id":"ravno","name":"Ravno","role":"user","avatar":"🐺","pinHash":"$2b$12$VtSd/FlLTnCSRj3EGCLjNOYq/BnhFQDSYl8XhfQlr85L4ovtuIRzS"},
  {"id":"gabriel","name":"Gabriel","role":"user","avatar":"🐗","pinHash":"$2b$12$7KfOPdWve6IkUdRv1EEXh.te3FmbYoewMrtcyRCnEFkddCqrJBd8m"},
  {"id":"benjamin","name":"Benjamin","role":"user","avatar":"🦄","pinHash":"$2b$12$Ryw4o3Npw9jftBbzNN/CXOvvjRMDcUNaKXqqeHKp4xvbRQrg2jiVS"},
  {"id":"alex","name":"Alex","role":"user","avatar":"🐺","pinHash":"$2b$12$.2qg7nTmqOj7VAMRqx3Xme/QjGO/gOAMUR8r/GOvwN23zGMziqSe2"},
  {"id":"arthur","name":"Arthur","role":"user","avatar":"🐯","pinHash":"$2b$12$d8x7IwtUsjM2LlZXXa6FEuyNZxTxtSE7CGYgqfQlnsuzEFTBCXm6q"},
  {"id":"felix","name":"Félix","role":"user","avatar":"🐗","pinHash":"$2b$12$9ONkV1G6NZ42Dye62fSmv.CI6ZBjHLy6wvUrNjDryzp33pt1PFAAq"},
  {"id":"nemo","name":"Némo","role":"user","avatar":"🧠","pinHash":"$2b$12$ftqO63s/vCzhZVYbDcRU6.2x.M0GAl3UgE3z1u9udD56gpKCyiRk."},
  {"id":"garreau","name":"Garreau","role":"user","avatar":"🐺","pinHash":"$2b$12$PPk309P6rBG9PjIjc9tmi.EQ7XACxZyqdykzFBxw8YEnP5soTAGgi"},
  {"id":"robin","name":"Robin","role":"user","avatar":"🧠","pinHash":"$2b$12$I6XpSjy4FLzeojTfaEk4oeRcNqkdHHVSBd55U6kXSwUmPbLVIvRXi"},
  {"id":"tim","name":"Tim","role":"user","avatar":"🦊","pinHash":"$2b$12$bagkSl./O6Is5dhvplVvNuLk8vBObWq6tBiNkjqkQA2QrSOtWRvGa"},
  {"id":"tom","name":"Tom","role":"user","avatar":"🦅","pinHash":"$2b$12$uiSJakZaRe2yDdzbAfrP4.Vn/66a91i2Z8Kpr6mM6iT1AdhCsxAou"},
];
