---
layout: home

hero:
  name: Elysion
  text: A collaborative whiteboard you can self-host
  tagline: An open-source alternative to Mural. Draw together in realtime, share boards and rooms, run a timer and a dot voting. A pre-release.
  image:
    src: /icon.svg
    alt: The Elysion icon
  actions:
    - theme: brand
      text: Run it
      link: /self-hosting
    - theme: alt
      text: Specifications
      link: /specs/frontend
    - theme: alt
      text: View on GitHub
      link: https://github.com/GravionLabs/elysion

features:
  - title: Boards, rooms and templates
    details: A board overview with rooms for teams, sharing with the roles owner, editor and viewer, built-in templates and your own, and PDF, PNG, SVG and .excalidraw export.
  - title: A realtime canvas
    details: Excalidraw in the ariadne look, light and dark, with sticky notes, connectors and a minimap. Every change is merged by Yjs CRDTs, and you see everybody's cursor.
  - title: Facilitation
    details: A shared timer with a countdown for everybody, and a dot voting with a ranked result when it ends, by the facilitator or when everybody has voted.
  - title: Identity you control
    details: Login through Keycloak. The BFF, the realtime service and the business backend each check the token, and a viewer's changes are refused by the server.
  - title: Four images
    details: Every merge to main publishes the frontend, BFF, realtime and business backend images to GHCR and creates a GitHub release, versioned by GitVersion.
  - title: A demo in one command
    details: pnpm demo starts the whole stack with Docker, including its own Valkey, and three users to log in with.
---

## Try it

With Docker, in one command (the images are built from a checkout; `docs/self-hosting.md` runs the published ones):

```sh
git clone https://github.com/GravionLabs/elysion.git && cd elysion
pnpm demo        # then open http://localhost and log in as dev, dev1 or dev2 (the password is the username)
```

## Where to read on

- [Self-hosting](./self-hosting): the published images, running the demo from them, and what a real deployment needs.
- [Specifications](./specs/frontend): how each service behaves, as built.
- [Decisions](./adr/0001-gateway-and-bff): why it is built this way (the ADRs).
- [Roadmap](./roadmap): what has been built and what is next. Read [what is missing](../README.md#what-is-missing) before relying on it.
