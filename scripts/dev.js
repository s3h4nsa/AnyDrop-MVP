const { createServer } = require("../server");

const port = Number(process.env.PORT || 3000);
const { server } = createServer();

server.listen(port, "0.0.0.0", () => {
  console.log(`AnyDrop dev server: http://localhost:${port}/app`);
});
