# Lens Try-On MVP (Camera Kit Web)

A minimal React + Vite app that opens the webcam and applies a Camera Kit Lens in real time.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Ensure `.env` contains these values (Vite only exposes `VITE_` prefixed vars):

```
VITE_API_TOKEN=your_camera_kit_api_token
VITE_LENS_ID=your_lens_uuid
VITE_LENS_GROUP_ID=your_group_uuid
```

3. Run the dev server:

```bash
npm run dev
```

## Notes

- Camera access requires a secure context. `http://localhost` is allowed, but remote devices should use HTTPS.
- Use a Lens built for Camera Kit (Lens Studio) that targets the correct body/garment behavior.
- The app mirrors the front camera for a natural try-on view.
