# Testing Guide for React Native Application

Testing the refactored React Native application requires ensuring that the backend is running (so the app can fetch data) and then launching the Expo development server to run the app on a simulator, emulator, or physical device.

Here is the most detailed, step-by-step guide to testing the app locally:

## 1. Ensure the Backend Server is Running
The React Native app relies on your Flask API. The Flask API should be running on `http://0.0.0.0:5002`. If it ever stops, you can start it from the `benchmarkwatcher` root directory using:

```bash
FLASK_DEBUG=1 TEMPLATES_AUTO_RELOAD=True flask run --host 0.0.0.0 --port 5002
```

## 2. Start the Expo Development Server
Open a new terminal window, navigate to the `mobile` directory, and start the Expo bundler:

```bash
cd /Users/s_avelova/Documents/projects/benchmarkwatcher/mobile
npm run start
# OR
npx expo start
```
This will start the Metro Bundler and display a large QR code in your terminal.

## 3. Choose Your Testing Environment
You have three main ways to test the app. Choose the one that works best for your setup:

### Option A: Test on your Physical Phone (Easiest & Most Accurate)
1. Download the **Expo Go** app from the App Store (iOS) or Google Play Store (Android).
2. Connect your phone to the same Wi-Fi network as your Mac.
3. Open your phone's Camera app (iOS) or the Expo Go app (Android) and scan the QR code generated in your terminal in Step 2.
4. The app will bundle and load on your device.

### Option B: Test on the iOS Simulator (Mac Only)
1. Ensure you have **Xcode** installed from the Mac App Store.
2. Open Xcode once to accept the terms and install any required components.
3. In the terminal where Expo is running, press the `i` key on your keyboard.
4. Expo will automatically launch the iOS Simulator, install the Expo Go client, and open the `BenchmarkWatcher` app.

### Option C: Test on the Android Emulator
1. Ensure you have **Android Studio** installed.
2. Open Android Studio, go to **Virtual Device Manager**, and start an Android Virtual Device (AVD).
3. In the terminal where Expo is running, press the `a` key on your keyboard.
4. Expo will connect to the running emulator and open the app.

## 4. What to Test & Verify (The Refactor Checklist)
Now that the app is running, go through these flows to ensure the newly refactored architecture is working flawlessly:

### 1. Home Screen Data Integrity:
- Check if commodities load correctly on launch.
- Ensure the API base URL fallback is working correctly to hit your local `5002` port.
- Pull-to-refresh the list; verify the loading spinner appears and data refreshes.

### 2. Modal Interactivity:
- Tap the **Search** icon (top right) and try typing a commodity name.
- Tap the **Sort** icon (top right) and change sorting between "Name", "Price", and "Volatility". Verify that the new `sortUtils.ts` handles this instantly.
- Tap the **Settings** icon (gear).

### 3. Settings Screen Modules:
- Inside settings, toggle **Dark Mode**. Keep an eye on the UI to ensure everything switches cleanly without flashing.
- Change the **Theme Flavor** (Try Bloomberg or Financial Times) and the **Market Color Theme**. Go back to the HomeScreen and verify the card colors match the selected theme.
- In the **"Data Sync"** section, tap **Force Sync Now** and verify it triggers a background refresh.

### 4. Commodity Detail Screen (The UI Extraction):
- Tap any commodity to enter the detail screen.
- Verify the new UI components (Copy Button, Badge, modular Data Source blocks) render beautifully.
- Tap the **Time Range Buttons** (1W, 1M, 6M, etc.) and verify the chart slices the data correctly without crashing.
- Tap the **"Download Chart"** icon (if available) and verify it successfully snapshots the view and opens the native OS share sheet.

### 5. Changelog Integrity:
- Go to Settings -> View Changelog.
- Verify the list parses the static objects accurately, scrolling smoothly without layout clipping.

## Troubleshooting Network Issues (Localhost)
If you are testing on a physical phone and the app loads but shows a "Network Error" or fails to fetch prices, it means your phone cannot reach `localhost:5002` on your Mac.

To fix this, you must explicitly tell Expo the IP address of your Mac on your Wi-Fi network:

1. Stop the expo server (`Ctrl + C`)
2. Find your Mac's IP address (System Settings -> Wi-Fi -> Details -> IP Address, e.g., `192.168.1.50`).
3. Run the expo server passing the API URL directly:

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.50:5002 npx expo start --clear
```
4. Reload the app on your phone.
