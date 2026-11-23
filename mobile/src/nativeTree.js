// Deliberately small bridge contract. Model code cannot send native module names or arbitrary props.
const components = new Set(['View', 'Text', 'Pressable', 'TextInput', 'ScrollView', 'Switch', 'ActivityIndicator', 'Button']);
const eventNames = new Set(['onPress', 'onChangeText', 'onValueChange']);
const textProps = new Set(['testID', 'accessibilityLabel', 'placeholder', 'value', 'title', 'color', 'placeholderTextColor', 'selectionColor', 'textAlign']);
const boolProps = new Set(['disabled', 'editable', 'multiline', 'secureTextEntry', 'autoFocus', 'horizontal', 'showsVerticalScrollIndicator', 'showsHorizontalScrollIndicator', 'selectable', 'animating']);
const numberProps = new Set(['numberOfLines', 'maxLength']);
const styleKeys = new Set(('display flex flexGrow flexShrink flexBasis flexDirection flexWrap justifyContent alignItems alignSelf alignContent gap rowGap columnGap width height minWidth maxWidth minHeight maxHeight aspectRatio margin marginTop marginBottom marginLeft marginRight marginHorizontal marginVertical padding paddingTop paddingBottom paddingLeft paddingRight paddingHorizontal paddingVertical backgroundColor color opacity borderRadius borderTopLeftRadius borderTopRightRadius borderBottomLeftRadius borderBottomRightRadius borderWidth borderTopWidth borderBottomWidth borderLeftWidth borderRightWidth borderColor fontSize fontWeight fontStyle fontFamily lineHeight letterSpacing textAlign textDecorationLine textTransform overflow position top bottom left right zIndex elevation').split(' '));
export const TREE_LIMITS = Object.freeze({ nodes: 1000, depth: 40, textLength: 20000, styleDepth: 10 });
function invalid(message, diagnostics) {
  const error = new Error(`${message}${diagnostics.actual !== undefined ? ` (${diagnostics.actual} > ${diagnostics.limit})` : ''} at ${diagnostics.path}`);
  error.name = 'NativeTreeValidationError'; error.diagnostics = diagnostics;
  throw error;
}
function style(value, path, depth = 0) {
  if (depth > TREE_LIMITS.styleDepth) invalid('Style exceeds depth limit', { code: 'STYLE_DEPTH_LIMIT', path, limit: TREE_LIMITS.styleDepth, actual: depth });
  if (Array.isArray(value)) return value.slice(0, 20).map((item, index) => style(item, `${path}[${index}]`, depth + 1));
  if (value == null || value === false) return undefined;
  if (typeof value !== 'object') invalid('Style must be an object', { code: 'INVALID_STYLE', path });
  return Object.fromEntries(Object.entries(value).filter(([key, v]) => styleKeys.has(key) && ((typeof v === 'string' && v.length < 160) || (typeof v === 'number' && Number.isFinite(v)))));
}
export function validateTree(input, {chatUI = false} = {}) {
  if (!Array.isArray(input)) invalid('Invalid native tree', { code: 'INVALID_TREE', path: '$' });
  let nodes = 0;
  const chatWidgets = {ChatMessages:0,ChatComposer:0};
  const ids = new Set();
  const visit = (node, depth = 0, parent = null, path = '$') => {
    const context = { path, component: typeof node?.type === 'string' ? node.type : typeof node, testID: typeof node?.props?.testID === 'string' ? node.props.testID.slice(0, 100) : undefined };
    if (++nodes > TREE_LIMITS.nodes) invalid('Native tree exceeds node limit', { ...context, code: 'NODE_LIMIT', limit: TREE_LIMITS.nodes, actual: nodes, depth });
    if (depth > TREE_LIMITS.depth) invalid('Native tree exceeds depth limit', { ...context, code: 'DEPTH_LIMIT', limit: TREE_LIMITS.depth, actual: depth, nodes });
    if (typeof node === 'string') {
      if (parent !== 'Text') invalid('Place text inside a Text component', { code: 'TEXT_OUTSIDE_TEXT', path });
      if (node.length > TREE_LIMITS.textLength) invalid('Text exceeds length limit', { code: 'TEXT_LENGTH_LIMIT', path, limit: TREE_LIMITS.textLength, actual: node.length });
      return node;
    }
    if (!node || !(components.has(node.type) || (chatUI && ['ChatMessages','ChatComposer','ChatStatus','ChatMarkdown','ChatScrollView'].includes(node.type))) || !Array.isArray(node.children) || typeof node.id !== 'string' || !/^\d+$/.test(node.id)) invalid('Unsupported native component', { ...context, code: 'UNSUPPORTED_COMPONENT' });
    if (chatUI && Object.hasOwn(chatWidgets,node.type)) chatWidgets[node.type]++;
    const props = {};
    for (const [key, value] of Object.entries(node.props || {})) {
      if (key === 'style' || key === 'contentContainerStyle' || (chatUI && ['ChatMessages','ChatComposer'].includes(node.type) && ['userStyle','assistantStyle','inputStyle','buttonStyle'].includes(key))) props[key] = style(value, `${path}.props.${key}`);
      else if (eventNames.has(key) && typeof value?.event === 'string' && /^\d+:on(Press|ChangeText|ValueChange)$/.test(value.event)) props[key] = { event: value.event };
      else if (textProps.has(key) && typeof value === 'string' && value.length <= 20000) props[key] = value;
      else if (key === 'value' && node.type === 'Switch' && typeof value === 'boolean') props[key] = value;
      else if (boolProps.has(key) && typeof value === 'boolean') props[key] = value;
      else if (numberProps.has(key) && Number.isInteger(value) && value >= 0 && value < 100000) props[key] = value;
      else if (key === 'size' && (value === 'small' || value === 'large')) props[key] = value;
      else if (key === 'keyboardType' && ['default', 'numeric', 'email-address', 'phone-pad', 'decimal-pad'].includes(value)) props[key] = value;
      else if (key === 'autoCapitalize' && ['none', 'sentences', 'words', 'characters'].includes(value)) props[key] = value;
    }
    if (props.testID) {
      if (ids.has(props.testID)) invalid('Duplicate testID: ' + props.testID, { ...context, code: 'DUPLICATE_TEST_ID' });
      ids.add(props.testID);
    }
    return { id: node.id, type: node.type, props, children: node.children.map((child, index) => visit(child, depth + 1, node.type, `${path}.children[${index}]`)) };
  };
  const result = input.map((node, index) => visit(node, 0, null, `$[${index}]`));
  if (chatUI && chatWidgets.ChatComposer>1) invalid('Only one host-bound composer is allowed', {code:'CHAT_WIDGETS_REQUIRED',path:'$'});
  return result;
}
export function findControl(tree, testID) {
  for (const node of tree) {
    if (typeof node === 'string') continue;
    if (node.props.testID === testID) return node;
    const found = findControl(node.children, testID);
    if (found) return found;
  }
  return null;
}
