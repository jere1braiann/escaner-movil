import { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Button, ActivityIndicator, Alert, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

type ExtractedData = { MSN: string; CT: string; UC: string } | null;

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const webviewOcrRef = useRef<WebView>(null);
  
  const [status, setStatus] = useState<string>('');
  const [isScanning, setIsScanning] = useState(false);
  const [ocrReady, setOcrReady] = useState(false);
  const [extractedData, setExtractedData] = useState<ExtractedData>(null);
  const [finalCode, setFinalCode] = useState<string | null>(null);

  const loopScan = async () => {
    if (!isScanning) return;
    
    if (cameraRef.current && webviewOcrRef.current) {
        try {
            const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.3 });
            if (photo?.base64) {
                // Enviar al WebView para OCR
                webviewOcrRef.current.postMessage(JSON.stringify({ type: 'PROCESS', image: photo.base64 }));
            } else {
                if (isScanning) setTimeout(loopScan, 1000);
            }
        } catch (e) {
            if (isScanning) setTimeout(loopScan, 1000);
        }
    } else {
        if (isScanning) setTimeout(loopScan, 1000);
    }
  };

  // Cuando arranca el escaneo, iniciamos el loop
  useEffect(() => {
    if (isScanning) {
        loopScan();
    }
  }, [isScanning]);

  if (!permission) {
    return <View />;
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.containerCenter}>
        <Text style={styles.permissionText}>
          Necesitamos tu permiso para acceder a la cámara
        </Text>
        <TouchableOpacity style={styles.btnPrimary} onPress={requestPermission}>
            <Text style={styles.btnPrimaryText}>Otorgar Permiso</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const startScanning = () => {
      if (!ocrReady) {
          Alert.alert("Aviso", "El motor OCR se está cargando, por favor espera un momento.");
          return;
      }
      setExtractedData(null);
      setFinalCode(null);
      setIsScanning(true);
      setStatus('Escaneando... mantén la cámara estable.');
  };

  const resetAll = () => {
      setExtractedData(null);
      setFinalCode(null);
      setIsScanning(false);
      setStatus('');
  };

  const handleOcrMessage = (event: any) => {
      try {
          const data = JSON.parse(event.nativeEvent.data);
          if (data.type === 'READY') {
              setOcrReady(true);
          } else if (data.type === 'SUCCESS' && isScanning) {
              setIsScanning(false);
              setStatus('¡Códigos detectados! Automatizando la web...');
              setExtractedData(data.data);
          } else if (data.type === 'FAIL' && isScanning) {
              // Seguir intentando
              setTimeout(loopScan, 500);
          } else if (data.type === 'ERROR' && isScanning) {
              // Seguir intentando a pesar del error interno
              setTimeout(loopScan, 1000);
          }
      } catch (e) {}
  };

  const ocrHtml = `
    <!DOCTYPE html>
    <html>
    <head>
    <script src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"></script>
    </head>
    <body>
    <canvas id="canvas"></canvas>
    <script>
      let worker = null;
      Tesseract.createWorker('eng').then(w => {
        worker = w;
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'READY' }));
      });

      window.addEventListener('message', async (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'PROCESS') {
            const base64Image = data.image;
            const img = new Image();
            img.onload = async () => {
              const canvas = document.getElementById('canvas');
              const ctx = canvas.getContext('2d');
              
              const inset = 0.12;
              const cropX = img.width * inset;
              const cropY = img.height * inset;
              const cropW = img.width * (1 - inset * 2);
              const cropH = img.height * (1 - inset * 2);
              
              const scale = 2.0;
              const scaledW = cropW * scale;
              const scaledH = cropH * scale;

              canvas.width = scaledW;
              canvas.height = scaledH;
              ctx.imageSmoothingEnabled = false;
              ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, scaledW, scaledH);

              const imageData = ctx.getImageData(0, 0, scaledW, scaledH);
              const px = imageData.data;
              for (let i = 0; i < px.length; i += 4) {
                  const r = px[i], g = px[i + 1];
                  if ((r + g) > 180) {
                      px[i] = 0; px[i+1] = 0; px[i+2] = 0;
                  } else {
                      px[i] = 255; px[i+1] = 255; px[i+2] = 255;
                  }
              }
              ctx.putImageData(imageData, 0, 0);
              
              const finalB64 = canvas.toDataURL('image/jpeg', 1.0);
              
              const result = await worker.recognize(finalB64);
              const texto = result.data.text;
              
              const fixHex = (str) => {
                if (!str) return "";
                return str.toUpperCase()
                    .replace(/O|Q/g, '0')
                    .replace(/I|L|T/g, '1')
                    .replace(/Z/g, '2')
                    .replace(/S/g, '5')
                    .replace(/G/g, '6');
              };

              let msn = "", ct = "", uc = "";
              const msnMatch = texto.match(/Machine Serial Number[:\\s]*([A-Z0-9]{8})/i) || texto.match(/\\b([A-Z0-9]{8})\\b/i);
              if (msnMatch) msn = fixHex(msnMatch[1] || msnMatch[0]);
              
              const ctMatch = texto.match(/Certified Time[:\\s]*([A-Z0-9]{8})/i);
              if (ctMatch) ct = fixHex(ctMatch[1]);
              else {
                const hex8 = texto.match(/\\b([A-Z0-9]{8})\\b/ig);
                if (hex8 && hex8.length > 1) ct = fixHex(hex8[1]);
              }
              
              const ucMatch = texto.match(/Usage Counter[:\\s]*[O0]*([1-9][A-Z0-9]*)/i);
              if (ucMatch) {
                  uc = ucMatch[1].replace(/O/ig, '0').replace(/I|L/ig, '1').replace(/S/ig, '5').replace(/Z/ig, '2').replace(/B/ig, '8');
              }
              
              if (msn && ct && uc) {
                 window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'SUCCESS', data: { MSN: msn, CT: ct, UC: uc } }));
              } else {
                 window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'FAIL' }));
              }
            };
            img.src = "data:image/jpeg;base64," + base64Image;
          }
        } catch(e) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ERROR', error: e.message }));
        }
      });
    </script>
    </body>
    </html>
  `;

  // --- JAVASCRIPT A INYECTAR EN LA WEB OFICIAL PARA AUTOMATIZAR ---
  const injectedJs = extractedData ? `
    const msn = "${extractedData.MSN}";
    const ct = "${extractedData.CT}";
    const uc = "${extractedData.UC}";

    function attemptFill() {
      try {
        const finalCodeEl = document.querySelector('#contSolucion h1.text-success');
        if (finalCodeEl && finalCodeEl.innerText.trim().length > 0) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'PORTAL_SUCCESS', code: finalCodeEl.innerText.trim() }));
          return;
        }

        const loginBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Iniciar sesión'));
        if (loginBtn) {
          loginBtn.click();
        }

        const inputMsn = document.querySelector('#input_msn');
        const contMsnBtn = document.querySelector('#contMSN button');
        if (inputMsn && contMsnBtn && inputMsn.offsetParent !== null) {
          if(inputMsn.value !== msn) {
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
            nativeSetter.call(inputMsn, msn);
            inputMsn.dispatchEvent(new Event('input', { bubbles: true }));
            contMsnBtn.click();
          }
        }

        const inputsCtUc = document.querySelectorAll('#contCT input');
        const contCtBtn = document.querySelector('#contCT button');
        if (inputsCtUc.length >= 2 && contCtBtn && inputsCtUc[0].offsetParent !== null) {
           if(inputsCtUc[0].value !== ct) {
              const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
              nativeSetter.call(inputsCtUc[0], ct);
              inputsCtUc[0].dispatchEvent(new Event('input', { bubbles: true }));

              nativeSetter.call(inputsCtUc[1], uc);
              inputsCtUc[1].dispatchEvent(new Event('input', { bubbles: true }));
              
              contCtBtn.click();
           }
        }
      } catch(e) {}
      setTimeout(attemptFill, 1000);
    }
    setTimeout(attemptFill, 1000);
    true;
  ` : '';

  return (
    <SafeAreaView style={styles.container}>
      {/* WEBVIEW OCULTO PARA TESSERACT OCR */}
      <WebView 
        ref={webviewOcrRef}
        originWhitelist={['*']}
        source={{ html: ocrHtml }}
        onMessage={handleOcrMessage}
        style={{ height: 0, width: 0, opacity: 0 }}
      />

      {extractedData && !finalCode ? (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.eyebrow}>Extracción Completada</Text>
                <Text style={styles.headerText}>MSN: {extractedData.MSN} | CT: {extractedData.CT}</Text>
                <Text style={styles.headerStatus}>{status}</Text>
            </View>
            <WebView
                source={{ uri: 'https://desbloqueos.educacioncba.edu.ar/provincia' }}
                style={{ flex: 1 }}
                injectedJavaScript={injectedJs}
                onMessage={(event: any) => {
                    try {
                        const data = JSON.parse(event.nativeEvent.data);
                        if(data.type === 'PORTAL_SUCCESS') {
                            setFinalCode(data.code);
                        }
                    } catch(e) {}
                }}
            />
        </View>
      ) : finalCode ? (
        <View style={styles.containerCenter}>
            <Text style={styles.eyebrow}>Código Listo</Text>
            <Text style={styles.hintText}>Ingresa este código en la netbook:</Text>
            <View style={styles.codeContainer}>
                <Text style={styles.codeText}>{finalCode}</Text>
            </View>
            <TouchableOpacity style={[styles.btnPrimary, {marginTop: 30, backgroundColor: '#34d399'}]} onPress={resetAll}>
                <Text style={[styles.btnPrimaryText, {color: '#062018'}]}>Desbloquear otro equipo</Text>
            </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.cameraWrapper}>
            <CameraView style={{ flex: 1 }} ref={cameraRef} facing="back" />
            <View style={styles.viewfinder}>
                {/* Guía visual para la pantalla */}
                <View style={styles.viewfinderBorder}>
                    <View style={[styles.corner, styles.cornerTL]} />
                    <View style={[styles.corner, styles.cornerTR]} />
                    <View style={[styles.corner, styles.cornerBL]} />
                    <View style={[styles.corner, styles.cornerBR]} />
                </View>
            </View>
            <View style={styles.buttonContainer}>
                {isScanning ? (
                    <View style={styles.scanningIndicator}>
                        <ActivityIndicator size="large" color="#3b82f6" />
                        <Text style={styles.scanningText}>{status}</Text>
                        <TouchableOpacity style={[styles.btnPrimary, {backgroundColor: '#f87171'}]} onPress={() => setIsScanning(false)}>
                            <Text style={styles.btnPrimaryText}>Detener</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <TouchableOpacity style={[styles.btnPrimary, !ocrReady && {opacity: 0.5}]} onPress={startScanning} disabled={!ocrReady}>
                        <Text style={styles.btnPrimaryText}>{ocrReady ? "Escanear pantalla" : "Cargando motor OCR..."}</Text>
                    </TouchableOpacity>
                )}
            </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0e14'
  },
  containerCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#0a0e14'
  },
  permissionText: {
    textAlign: 'center',
    marginBottom: 20,
    color: '#e7edf5',
    fontSize: 16
  },
  cameraWrapper: {
    flex: 1,
    backgroundColor: '#000',
    position: 'relative'
  },
  viewfinder: {
      position: 'absolute',
      top: '12%',
      left: '12%',
      right: '12%',
      bottom: '12%',
      justifyContent: 'center',
      alignItems: 'center',
      pointerEvents: 'none'
  },
  viewfinderBorder: {
      width: '100%',
      height: '100%',
      borderWidth: 0,
      backgroundColor: 'transparent',
      position: 'relative'
  },
  corner: {
      position: 'absolute',
      width: 30,
      height: 30,
      borderColor: '#3b82f6',
  },
  cornerTL: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 10 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 10 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 10 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 10 },
  buttonContainer: {
    position: 'absolute',
    bottom: 40,
    width: '100%',
    paddingHorizontal: 24
  },
  btnPrimary: {
    width: '100%',
    backgroundColor: '#3b82f6',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center'
  },
  btnPrimaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.5
  },
  scanningIndicator: {
    backgroundColor: '#121824',
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#26324a'
  },
  scanningText: {
    color: '#e7edf5',
    marginTop: 12,
    marginBottom: 20,
    textAlign: 'center',
    fontWeight: '600',
    fontSize: 15
  },
  header: {
    padding: 20,
    backgroundColor: '#121824',
    borderBottomWidth: 1,
    borderBottomColor: '#26324a'
  },
  eyebrow: {
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: '#3b82f6',
    marginBottom: 6,
    textAlign: 'center'
  },
  headerText: {
    color: '#e7edf5',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center'
  },
  headerStatus: {
      color: '#34d399',
      fontSize: 14,
      fontWeight: 'bold',
      textAlign: 'center',
      marginTop: 8
  },
  hintText: {
    color: '#8a97ab',
    fontSize: 15,
    marginBottom: 20
  },
  codeContainer: {
    paddingVertical: 20,
    paddingHorizontal: 30,
    backgroundColor: 'rgba(52,211,153,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(52,211,153,0.35)',
    borderRadius: 14,
    width: '100%'
  },
  codeText: {
    fontSize: 42,
    color: '#34d399',
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 1
  }
});
