// API reference: https://www.figma.com/plugin-docs/api/api-reference/

type Token = {
  $type: string
  $value: VariableValue
  // id: string
  // alias: string | undefined
}

figma.showUI(__uiFiles__['export'], {
  width: 500,
  height: 500,
  themeColors: true,
})

const COLLECTION_MAPPING = {
  Sizes: 'size',
  'Color Tokens': 'color',
  Typography: 'typography',
  Border: 'border',
  Opacity: 'opacity',
  'Base Colors': 'base-color',
} as {
  [key: string]: string
}

const MODE_MAPPING = {
  Default: 'default',
  Dark: 'dark',
  'Light – High Contrast': 'light-contrast',
  'Dark – High Contrast': 'dark-contrast',
  desktop: 'default',
  'Mode 1': 'default', // Typography
} as {
  [key: string]: string
}

type TokenData = {
  [key: string]: {
    [key: string]: Token
  }
} | {
  [key: string]: {
    [key: string]: {
      [key: string]: Token
    }
  }
}

const variablesDb = {} as {
  [key in keyof typeof COLLECTION_MAPPING]: TokenData
}

const textStylesJSON = {} as {
  [key: string]: TokenData
}

const effectStylesJSON = {} as {
  [key: string]: TokenData
}

function set(obj: unknown, path: string[], value: unknown): unknown {
  path.reduce((acc, key, index) => {
    if (index === path.length - 1) {
      acc[key] = value;
    } else {
      if (!acc[key]) {
        acc[key] = {};
      }
    }
    return acc[key];
  }, obj);

  return obj;
}

const rgbToHex = (data: VariableValue) => {
  const { r, g, b, a } = data as RGBA
  if (a !== 1) {
    return `rgba(${[r, g, b]
      .map((n) => Math.round(n * 255))
      .join(', ')}, ${a.toFixed(4)})`;
  }
  const toHex = (value: number) => {
    const hex = Math.round(value * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };

  const hex = [toHex(r), toHex(g), toHex(b)].join('');
  return `#${hex}`;
}

const sanitizeCollectionName = (name: string) => name.split('.')[1].trim()

const getCollectionName = (collection: VariableCollection | null) => {
  if (!collection) {
    return ''
  }

  return COLLECTION_MAPPING[sanitizeCollectionName(collection.name)]
}

const isVariableAlias = (value: VariableValue) => {
  return typeof value === 'object' && 'type' in value && 'id' in value
}

const getTokenType = (resolvedType: VariableResolvedDataType) => {
  if (resolvedType === 'COLOR') return 'color'
  // assuming that the only string data in tokens are font family values
  if (resolvedType === 'STRING') return 'fontFamily'
  return 'number'
}

const getTokenValue = async (variable: Variable, modeId: string): Promise<Token> => {
  const { resolvedType } = variable
  const value = variable.valuesByMode[modeId]
  const token = {
    // name: name,
    $type: getTokenType(resolvedType),
    $value: value,
    // id: value.id,
    // alias: undefined as string | undefined,
  }
  if (isVariableAlias(value) && value.type === 'VARIABLE_ALIAS') {
    const currentVar = await figma.variables.getVariableByIdAsync(
      value.id
    );
    const aliasCollection = await figma.variables.getVariableCollectionByIdAsync(currentVar?.variableCollectionId || '')
    const aliasCollectionName = getCollectionName(aliasCollection)
    token.$value = `{${aliasCollectionName}.${currentVar?.name.replace(/\//g, '.')}}`;
  } else {
    // token.id = variable.id;
    token.$value = resolvedType === 'COLOR' ? rgbToHex(value) : value;
  }
  return token
}

const buildTokenData = async (modeId: string, variable: Variable, variables: TokenData = {}) => {
  const howManySlashes = variable.name.split('/').length
  // for example, background/primary
  // it should be: { background: { primary: { $type: 'color', $value: '#000000' } } }
  if (howManySlashes === 2) {
    const [group, name] = variable.name.split('/')
    variables[group] = variables[group] || {}
    variables[group][name] = await getTokenValue(variable, modeId)
    return variables
  }

  // for example, button/background/primary
  // it should be: { button: { background: { primary: { $type: 'color', $value: '#000000' } } } }
  if (howManySlashes === 3) {
    const [group, parent, name] = variable.name.split('/')
    variables[group] = variables[group] || {}
    variables[group][parent] = variables[group][parent] || {}
    
    variables[group][parent][name] = await getTokenValue(variable, modeId)
    return variables
  }
}

const getVariablesFromCollection = async (modeId: string, variableIds: string[]) => {
  const variables = {} as TokenData
  for (const variableId of variableIds) {
    const variable = await figma.variables.getVariableByIdAsync(variableId)

    if (!variable) {
      continue;
    }

    const { resolvedType } = variable
    const value = variable.valuesByMode[modeId]
    if (value !== undefined && ['COLOR', 'FLOAT', 'STRING'].includes(resolvedType)) {
      await buildTokenData(modeId, variable, variables)
    }
  }
  return variables
}

async function processCollection(variableColection: VariableCollection) {
  const { variableIds } = variableColection
  const collectionName = getCollectionName(variableColection)
  if (variablesDb[collectionName] === undefined) {
    variablesDb[collectionName] = variablesDb[collectionName] || {}
  }
  for (const mode of variableColection.modes) {
    const modeName = MODE_MAPPING[mode.name]
    const result = await getVariablesFromCollection(mode.modeId, variableIds)
    if (!['base-color', 'size', 'typography', 'border'].includes(collectionName)) {
      variablesDb[collectionName][modeName] = variablesDb[collectionName][modeName] || {}
      variablesDb[collectionName][modeName] = result
      continue
    }
    
    variablesDb[collectionName] = result
  }
}


const createJsonFiles = () => {
  // console.log('variablesDb', variablesDb)
  const finalJSON = {} as {
    [key: string]: {
      file: string
      content: TokenData
    }
  }
  const sizeJson = variablesDb['size']
  finalJSON['sizes.json'] = {
    file: 'sizes.json',
    content: {
      size: sizeJson
    }
  }

  const typographyJson = variablesDb['typography']
  finalJSON['typography.json'] = {
    file: 'typography.json',
    content: {
      typography: {
        ...typographyJson,
        ...textStylesJSON
      }
    }
  }

  const borderJson = variablesDb['border']
  finalJSON['borders.json'] = {
    file: 'borders.json',
    content: {
      border: borderJson
    }
  }

  const opacityJson = variablesDb['opacity']
  finalJSON['opacity/base.json'] = {
    file: 'base.json',
    content: {
      opacity: {
        level: opacityJson.default.level
      }
    }
  }
  finalJSON['opacity/default.json'] = {
    file: 'default.json',
    content: {
      opacity: {
        default: {
          background: opacityJson.default.background
        }
      }
    }
  }
  finalJSON['opacity/dark.json'] = {
    file: 'dark.json',
    content: {
      opacity: {
        dark: {
          background: opacityJson.dark.background
        }
      }
    }
  }
  finalJSON['opacity/dark-contrast.json'] = {
    file: 'dark-contrast.json',
    content: {
      opacity: {
        'dark-contrast': {
          background: opacityJson['dark-contrast'].background
        }
      }
    }
  }
  finalJSON['opacity/light-contrast.json'] = {
    file: 'light-contrast.json',
    content: {
      opacity: {
        'light-contrast': {
          background: opacityJson['light-contrast'].background
        }
      }
    }
  }

  const baseColor = variablesDb['base-color']
  finalJSON['colors/primitives.json'] = {
    file: 'primitives.json',
    content: {
      'base-color': baseColor
    }
  }

  const colorJson = variablesDb['color']
  finalJSON['colors/default.json'] = {
    file: 'default.json',
    content: {
      color: {
        default: colorJson.default
      }
    }
  }
  finalJSON['colors/dark.json'] = {
    file: 'dark.json',
    content: {
      color: {
        dark: colorJson.dark
      }
    }
  }
  finalJSON['colors/dark-contrast.json'] = {
    file: 'dark-contrast.json',
    content: {
      color: {
        'dark-contrast': colorJson['dark-contrast']
      }
    }
  }
  finalJSON['colors/light-contrast.json'] = {
    file: 'light-contrast.json',
    content: {
      color: {
        'light-contrast': colorJson['light-contrast']
      }
    }
  }

  finalJSON['shadows.json'] = {
    file: 'shadows.json',
    content: effectStylesJSON
  }

  return JSON.parse(JSON.stringify(finalJSON).replaceAll('base-color', 'color'))
}

const processTextStyle = async (style: TextStyle, collection: VariableCollection | undefined) => {
  const modeId = collection?.modes[0].modeId || ''
  for (const key in style.boundVariables) {
    const variable = style.boundVariables[key as VariableBindableTextField]
    const value = await figma.variables.getVariableByIdAsync(
      variable?.id || ''
    )
    if (!value) {
      continue
    }
    const token = await getTokenValue(value, modeId)
    const howManySlashes = style.name.split('/').length
    // maybe you can use https://lodash.com/docs/4.17.15#set
    if (howManySlashes === 2) {
      const [group, name] = style.name.split('/')
      textStylesJSON[group] = textStylesJSON[group] || {}
      textStylesJSON[group][name] = textStylesJSON[group][name] || {}
      textStylesJSON[group][name][key] = token
      // return textStylesJSON
    } else if (howManySlashes === 3) {
      const [group, parent, name] = style.name.split('/')
      textStylesJSON[group] = textStylesJSON[group] || {}
      textStylesJSON[group][parent] = textStylesJSON[group][parent] || {}
      textStylesJSON[group][parent][name] = textStylesJSON[group][parent][name] || {}
      
      textStylesJSON[group][parent][name][key] = token
    }
  }
}

const processEffectStyle = async (style: EffectStyle) => {
  const effects = style.effects[0]
  const token = {
    radius: {
      $type: 'number',
      $value: effects.radius
    },
    spread: {
      $type: 'number',
      $value: effects.spread
    },
    offset: {
      y: {
        $type: 'number',
        $value: effects.offset.y
      },
      x: {
        $type: 'number',
        $value: effects.offset.x
      },
    },
    color: {
      $type: 'color',
      $value: rgbToHex(effects.color)
    }
  }

  set(effectStylesJSON, style.name.split('/'), token)
}

async function exportToJSON() {
  // VariableCollection
  // https://www.figma.com/plugin-docs/api/VariableCollection/
  const collections = await figma.variables.getLocalVariableCollectionsAsync()
  for (const collection of collections) {
    await processCollection(collection)
  }
  
  const collection = collections.find((collection) => {
    return sanitizeCollectionName(collection.name) === 'Typography'
  })
  const textStyles = await figma.getLocalTextStylesAsync()
  for (const style of textStyles) {
    await processTextStyle(style, collection)
  }
  
  const effectStyles = await figma.getLocalEffectStylesAsync()
  for (const style of effectStyles) {
    // this Effect Style does not have any bound variables
    if (style.name === 'Shadow') {
      continue
    }
    await processEffectStyle(style)
  }

  const result = createJsonFiles()
  
  figma.ui.postMessage({ type: 'EXPORT_RESULT', tokens: result })
}

figma.ui.onmessage = (message) => {
  if (message.type === 'EXPORT') {
    exportToJSON()
  }
}

