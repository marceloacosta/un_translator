# UN Translator

Real-time speech-to-speech translation PWA that works like a UN interpreter. Point your phone's microphone at someone speaking another language and hear the translation in your headphones in near real-time.

## Features

- 🎙️ Real-time audio capture
- 🌐 Multi-language translation
- 🎧 Headphone-optimized output
- 📱 Mobile-first PWA design
- ☁️ AWS Amplify deployment

## Tech Stack

- **Frontend:** Next.js + React + TypeScript + Tailwind CSS
- **Audio:** Web Audio API
- **Translation:** Amazon Nova Sonic (speech-to-speech)
- **Hosting:** AWS Amplify

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/marceloacosta/un_translator.git
cd un_translator

# Install dependencies
npm install

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

### Testing Audio

1. Open the app in your browser
2. Put on headphones
3. Click "Test Audio Loopback"
4. Speak into your microphone
5. You should hear yourself through your headphones

## Deployment

This project is deployed on AWS Amplify. Push to the `main` branch to trigger automatic deployment.

## Project Status

🚧 **Work in Progress**

- [x] Audio loopback test
- [ ] Nova Sonic integration
- [ ] Real-time translation
- [ ] PWA optimization

## License

MIT
