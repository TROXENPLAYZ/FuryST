const json = (data, status = 200) => new Response(JSON.stringify(data, null, 2), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  }
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        project: "Elyndor",
        service: "Cloudflare Worker",
        timestamp: new Date().toISOString()
      });
    }

    if (url.pathname === "/api/progress") {
      return json({
        project: "Elyndor",
        engine: "Godot 4.7.2",
        status: "In development",
        confirmed: [
          "Voxel terrain streaming prototype",
          "Player walking and jumping",
          "Ground collision detected during testing"
        ],
        inProgress: [
          "Reducing stutter during exploration of new terrain",
          "Improving chunk generation and collision scheduling",
          "Testing reliable world persistence"
        ],
        note: "Development status reflects current project notes and is not a release promise."
      });
    }

    return env.ASSETS.fetch(request);
  }
};
