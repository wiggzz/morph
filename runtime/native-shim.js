export const View = 'View';
export const Text = 'Text';
export const Pressable = 'Pressable';
export const TextInput = 'TextInput';
export const ScrollView = 'ScrollView';
export const Switch = 'Switch';
export const ActivityIndicator = 'ActivityIndicator';
export const Button = 'Button';
export const SafeAreaView = 'View';
export const StyleSheet = {
  create: value => value,
  flatten: value => Array.isArray(value) ? Object.assign({}, ...value.map(v => StyleSheet.flatten(v))) : (value || {}),
  hairlineWidth: 1,
  absoluteFillObject: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
};
export const Platform = { OS: 'android', select: value => value.android ?? value.native ?? value.default };
export const Dimensions = { get: () => ({ width: 393, height: 700, scale: 1, fontScale: 1 }) };
