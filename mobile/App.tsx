import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import {
  Alert,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';

const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

type AuthSession = {
  token: string;
  user: { id: string; email: string; name: string };
};

type PickedImage = {
  uri: string;
  name: string;
  type: string;
};

type VerifyResult = {
  verified: boolean;
  label: 'Trusted' | 'Limited history' | 'Warning' | 'Not protected';
  message: string;
  identik_name?: string | null;
};

export default function App() {
  const [email, setEmail] = useState('demo@identik.dev');
  const [password, setPassword] = useState('identik-demo');
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [identikName, setIdentikName] = useState('demo.identik');
  const [protectImage, setProtectImage] = useState<PickedImage | null>(null);
  const [protectStatus, setProtectStatus] = useState<string | null>(null);
  const [protectLoading, setProtectLoading] = useState(false);

  const [checkImage, setCheckImage] = useState<PickedImage | null>(null);
  const [verifyStatus, setVerifyStatus] = useState<VerifyResult | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);

  const signIn = async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? 'Sign-in failed.');
      setSession({ token: data.token, user: data.user });
      Alert.alert('Signed in', 'You can now activate Identik Names and protect photos.');
    } catch (error) {
      Alert.alert('Sign-in failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const register = async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name: email })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? 'Registration failed.');
      Alert.alert('Check your inbox', 'Verify your email to finish creating your Identik account.');
    } catch (error) {
      Alert.alert('Registration failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const signOut = async () => {
    if (session) {
      await fetch(`${apiBaseUrl}/api/auth/sign-out`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.token}` }
      }).catch(() => {});
    }
    setSession(null);
    Alert.alert('Signed out', 'You are signed out of Identik on this device.');
  };

  const pickImage = async (setImage: (value: PickedImage | null) => void) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow Identik to access your photo library.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1
    });
    if (!result.canceled && result.assets?.[0]) {
      const asset = result.assets[0];
      setImage({
        uri: asset.uri,
        name: asset.fileName ?? `photo-${Date.now()}.jpg`,
        type: asset.mimeType ?? 'image/jpeg'
      });
    }
  };

  const protectPhoto = async () => {
    if (!session) {
      Alert.alert('Sign in required', 'Sign in before protecting a photo.');
      return;
    }
    if (!protectImage) {
      Alert.alert('Select a photo', 'Choose a photo to protect.');
      return;
    }
    if (!identikName.trim()) {
      Alert.alert('Add Identik Name', 'Enter the Identik Name you want to sign as.');
      return;
    }
    setProtectLoading(true);
    setProtectStatus(null);
    try {
      const formData = new FormData();
      formData.append('identikName', identikName.trim());
      formData.append('file', {
        uri: protectImage.uri,
        name: protectImage.name,
        type: protectImage.type
      } as unknown as Blob);

      const response = await fetch(`${apiBaseUrl}/api/v1/sign`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.token}` },
        body: formData
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unable to protect that photo right now.' }));
        throw new Error(error?.error ?? 'Unable to protect that photo right now.');
      }

      const summaryHeader = response.headers.get('x-identik-summary');
      const summary = summaryHeader ? JSON.parse(summaryHeader) : null;
      setProtectStatus(
        summary?.identik_name
          ? `Photo protected under ${summary.identik_name}. Download the signed copy from the web app.`
          : 'Photo protected successfully.'
      );
    } catch (error) {
      Alert.alert('Protect failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setProtectLoading(false);
    }
  };

  const checkPhoto = async () => {
    if (!checkImage) {
      Alert.alert('Select a photo', 'Choose a photo to check.');
      return;
    }
    setVerifyLoading(true);
    setVerifyStatus(null);
    try {
      const formData = new FormData();
      formData.append('file', {
        uri: checkImage.uri,
        name: checkImage.name,
        type: checkImage.type
      } as unknown as Blob);

      const response = await fetch(`${apiBaseUrl}/api/v1/verify`, {
        method: 'POST',
        body: formData
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? 'Unable to check that photo right now.');
      }

      setVerifyStatus(data as VerifyResult);
    } catch (error) {
      Alert.alert('Check failed', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setVerifyLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Identik</Text>
        <Text style={styles.subtitle}>Trusted identity for trusted media.</Text>
        <View style={styles.card}>
          {session ? (
            <>
              <Text style={styles.cardTitle}>Signed in as</Text>
              <Text style={styles.signedInEmail}>{session.user.email}</Text>
              <TouchableOpacity style={styles.secondaryBtn} onPress={signOut}>
                <Text style={styles.secondaryBtnText}>Sign out</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.cardTitle}>Sign in to Identik</Text>
              <TextInput
                style={styles.input}
                placeholder="you@example.com"
                placeholderTextColor="#8ea0bd"
                autoCapitalize="none"
                keyboardType="email-address"
                value={email}
                onChangeText={setEmail}
              />
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor="#8ea0bd"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />
              <TouchableOpacity style={styles.primaryBtn} onPress={signIn} disabled={isSubmitting}>
                <Text style={styles.primaryBtnText}>{isSubmitting ? 'Please wait…' : 'Sign in'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={register} disabled={isSubmitting}>
                <Text style={styles.secondaryBtnText}>Create account</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Protect a photo</Text>
          <TextInput
            style={styles.input}
            placeholder="jenny.identik"
            placeholderTextColor="#8ea0bd"
            value={identikName}
            onChangeText={setIdentikName}
          />
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => pickImage(setProtectImage)}>
            <Text style={styles.secondaryBtnText}>
              {protectImage ? 'Replace selected photo' : 'Choose a photo to protect'}
            </Text>
          </TouchableOpacity>
          {protectStatus && <Text style={styles.helperTextDark}>{protectStatus}</Text>}
          <TouchableOpacity style={styles.primaryBtn} onPress={protectPhoto} disabled={protectLoading}>
            <Text style={styles.primaryBtnText}>{protectLoading ? 'Protecting…' : 'Protect this photo'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Check a photo</Text>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => pickImage(setCheckImage)}>
            <Text style={styles.secondaryBtnText}>
              {checkImage ? 'Replace selected photo' : 'Choose a photo to check'}
            </Text>
          </TouchableOpacity>
          {verifyStatus && (
            <View style={styles.verifyBadge}>
              <Text style={styles.verifyBadgeTitle}>{verifyStatus.label}</Text>
              <Text style={styles.verifyBadgeText}>{verifyStatus.message}</Text>
              {verifyStatus.identik_name && (
                <Text style={styles.verifyBadgeText}>Identik Name: {verifyStatus.identik_name}</Text>
              )}
            </View>
          )}
          <TouchableOpacity style={styles.primaryBtn} onPress={checkPhoto} disabled={verifyLoading}>
            <Text style={styles.primaryBtnText}>{verifyLoading ? 'Checking…' : 'Check this photo'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0d1b2a' },
  scrollContent: { padding: 24, gap: 20 },
  title: { color: '#ffffff', fontSize: 32, fontWeight: '700' },
  subtitle: { color: 'rgba(255,255,255,0.8)', marginBottom: 8 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 20,
    gap: 14,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 20
  },
  cardTitle: { fontSize: 18, fontWeight: '600' },
  signedInEmail: { fontSize: 16, marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#d1d8e5',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16
  },
  primaryBtn: { backgroundColor: '#1a4d8f', borderRadius: 999, paddingVertical: 12, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  secondaryBtn: { borderRadius: 999, borderWidth: 2, borderColor: '#00c2a8', paddingVertical: 12, alignItems: 'center' },
  secondaryBtnText: { color: '#00c2a8', fontWeight: '600' },
  helperTextDark: { color: '#4a5668' },
  verifyBadge: { backgroundColor: 'rgba(13,27,42,0.05)', padding: 12, borderRadius: 16, gap: 4 },
  verifyBadgeTitle: { fontWeight: '700', fontSize: 16 },
  verifyBadgeText: { color: '#4a5668' }
});
