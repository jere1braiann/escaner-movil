import { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { WebView, WebViewMessageEvent } from 'react-native-webview';

type ExtractedData = { MSN: string; CT: string; UC: string };

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  
  const [status, setStatus] = useState<string>('');
  const [isScanning, setIsScanning] = useState(false);
  
  // States to manage the flow
  const [validatingData, setValidatingData] = useState<ExtractedData | null>(null);
  const [automating, setAutomating] = useState<ExtractedData | null>(null);
  const [finalCode, setFinalCode] = useState<string | null>(null);

  // Gemini API Key from .env
  const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY;

  const loopScan = async () => {
    if (!isScanning) return;
    
    if (cameraRef.current && GEMINI_API_KEY) {
        try {
            const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.5 });
            if (photo?.base64) {
                setStatus('Analizando con IA...');
                
                const prompt = `Analiza la imagen de esta pantalla azul de bloqueo.
Extrae estrictamente:
1. Machine Serial Number (8 caracteres, los primeros 8 dígitos del MSN)
2. Certified Time (8 caracteres)
3. Usage Counter (solo el número final, sin ceros, por ejemplo si dice '00000001' extrae '1')

Responde ÚNICAMENTE con JSON válido en este formato exacto:
{"MSN": "VALOR", "CT": "VALOR", "UC": "VALOR"}
No incluyas markdown, ni comillas extra, solo el bloque JSON puro.`;

                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{
                            parts: [
                                { text: prompt },
                                { inline_data: { mime_type: "image/jpeg", data: photo.base64 } }
                            ]
                        }],
                        generationConfig: { temperature: 0.1 }
                    })
                });

                const result = await response.json();
                
                if (result.candidates && result.candidates[0]) {
                    let text = result.candidates[0].content.parts[0].text.trim();
                    if (text.startsWith('```json')) text = text.substring(7);
                    if (text.startsWith('```')) text = text.substring(3);
                    if (text.endsWith('```')) text = text.substring(0, text.length - 3);
                    
                    try {
                        const parsed = JSON.parse(text.trim());
                        if (parsed.MSN && parsed.CT && parsed.UC) {
                            setIsScanning(false);
                            setStatus('');
                            setValidatingData({
                                MSN: parsed.MSN.toUpperCase(),
                                CT: parsed.CT.toUpperCase(),
                                UC: parsed.UC
                            });
                            return; // Stop loop
                        }
                    } catch (e) {
                        console.log("Error parseando JSON de Gemini:", text);
                    }
                }
            }
            // Si falló, seguimos intentando
            if (isScanning) setTimeout(loopScan, 1500);
        } catch (e) {
            console.log("Error consultando Gemini:", e);
            if (isScanning) setTimeout(loopScan, 1500);
        }
    } else {
        if (!GEMINI_API_KEY) {
            Alert.alert("Error", "Falta configurar EXPO_PUBLIC_GEMINI_API_KEY en el archivo .env");
            setIsScanning(false);
        } else {
            if (isScanning) setTimeout(loopScan, 1000);
        }
    }
  };

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
      setValidatingData(null);
      setAutomating(null);
      setFinalCode(null);
      setIsScanning(true);
      setStatus('Capturando pantalla...');
  };

  const resetAll = () => {
      setValidatingData(null);
      setAutomating(null);
      setFinalCode(null);
      setIsScanning(false);
      setStatus('');
  };

  // JAVASCRIPT A INYECTAR EN LA WEB OFICIAL PARA AUTOMATIZAR
  const injectedJs = automating ? `
    const msn = "${automating.MSN}";
    const ct = "${automating.CT}";
    const uc = "${automating.UC}";

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
      
      {finalCode ? (
        // PANTALLA 4: RESULTADO FINAL
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

      ) : automating ? (
        // PANTALLA 3: AUTOMATIZANDO WEB
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.eyebrow}>Generando Código</Text>
                <Text style={styles.headerText}>MSN: {automating.MSN} | CT: {automating.CT}</Text>
                <Text style={styles.headerStatus}>El bot está completando el portal oficial...</Text>
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

      ) : validatingData ? (
        // PANTALLA 2: VALIDACIÓN DE DATOS (OCR Gemini)
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
            <ScrollView contentContainerStyle={styles.scrollCenter}>
                <Text style={styles.eyebrow}>Revisión</Text>
                <Text style={styles.hintText}>Verifica que la IA haya leído bien los códigos:</Text>
                
                <View style={styles.field}>
                    <Text style={styles.label}>Machine Serial Number</Text>
                    <TextInput 
                        style={styles.input} 
                        value={validatingData.MSN} 
                        onChangeText={t => setValidatingData({...validatingData, MSN: t.toUpperCase()})}
                        autoCapitalize="characters"
                    />
                </View>
                
                <View style={styles.field}>
                    <Text style={styles.label}>Certified Time</Text>
                    <TextInput 
                        style={styles.input} 
                        value={validatingData.CT} 
                        onChangeText={t => setValidatingData({...validatingData, CT: t.toUpperCase()})}
                        autoCapitalize="characters"
                    />
                </View>
                
                <View style={styles.field}>
                    <Text style={styles.label}>Usage Counter</Text>
                    <TextInput 
                        style={styles.input} 
                        value={validatingData.UC} 
                        onChangeText={t => setValidatingData({...validatingData, UC: t})}
                        keyboardType="number-pad"
                    />
                </View>

                <TouchableOpacity style={[styles.btnPrimary, {backgroundColor: '#34d399', marginTop: 10}]} onPress={() => setAutomating(validatingData)}>
                    <Text style={[styles.btnPrimaryText, {color: '#062018'}]}>Confirmar y desbloquear</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.btnSecondary} onPress={() => {
                    setValidatingData(null);
                    startScanning();
                }}>
                    <Text style={styles.btnSecondaryText}>Volver a escanear</Text>
                </TouchableOpacity>
            </ScrollView>
        </KeyboardAvoidingView>

      ) : (
        // PANTALLA 1: ESCÁNER
        <View style={styles.cameraWrapper}>
            <CameraView style={{ flex: 1 }} ref={cameraRef} facing="back" />
            <View style={styles.viewfinder}>
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
                    <TouchableOpacity style={styles.btnPrimary} onPress={startScanning}>
                        <Text style={styles.btnPrimaryText}>Escanear pantalla</Text>
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
  scrollCenter: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
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
  btnSecondary: {
    width: '100%',
    backgroundColor: 'transparent',
    borderColor: '#26324a',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 15
  },
  btnSecondaryText: {
    color: '#e7edf5',
    fontSize: 16,
    fontWeight: '600'
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
      color: '#3b82f6',
      fontSize: 14,
      fontWeight: 'bold',
      textAlign: 'center',
      marginTop: 8
  },
  hintText: {
    color: '#8a97ab',
    fontSize: 15,
    marginBottom: 20,
    textAlign: 'center'
  },
  field: {
    marginBottom: 16,
    width: '100%'
  },
  label: {
    fontFamily: 'monospace',
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: '#8a97ab',
    marginBottom: 8
  },
  input: {
    width: '100%',
    backgroundColor: '#1a2333',
    borderColor: '#26324a',
    borderWidth: 1,
    borderRadius: 10,
    padding: 16,
    color: '#e7edf5',
    fontSize: 16,
    fontFamily: 'monospace',
    letterSpacing: 1
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
