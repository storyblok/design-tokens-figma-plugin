// API reference: https://www.figma.com/plugin-docs/api/api-reference/

type Token = {
  $type: string
  $value: VariableValue
}

figma.showUI(__uiFiles__['export'], {
  width: 500,
  height: 500,
  themeColors: true,
})

const COLLECTION_MAPPING = {
  Sizes: 'size',
  'Color Tokens': 'color',
  Typography: 'font',
  Border: 'border',
  Opacity: 'opacity',
  'Base Colors': 'base-color',
} as {
  [key: string]: string
}

const MODE_MAPPING = {
  Default: 'default',
  Dark: 'dark',
  'Light – High Contrast': 'light-high-contrast',
  'Dark – High Contrast': 'dark-high-contrast',
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
      acc[key] = value
    } else {
      if (!acc[key]) {
        acc[key] = {}
      }
    }
    return acc[key]
  }, obj)

  return obj
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

const getVariableValue = (variable: Variable, modeId: string) => {
  const value = variable.valuesByMode[modeId]
  if (variable.name.includes('line_height/') && variable.resolvedType === 'FLOAT' && typeof value === 'number') {
    return Number(value.toFixed(2))
  }

  const valuesToPx = ['size/', 'unit/', 'view_port/', 'radius/', 'width/']
  if (valuesToPx.some(value => variable.name.includes(value)) && variable.resolvedType === 'FLOAT' && typeof value === 'number') {
    return `${value}px`
  }

  if (variable.name.includes('level/') && variable.resolvedType === 'FLOAT' && typeof value === 'number') {
    return `${value}%`
  }

  return value
}

const getTokenValue = async (variable: Variable, modeId: string): Promise<Token> => {
  const { resolvedType } = variable
  const value = getVariableValue(variable, modeId)
  const token = {
    $type: getTokenType(resolvedType),
    $value: value,
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

const getVariableAlias = async (variableAlias: VariableAlias | undefined) => {
  if (!variableAlias) return undefined

  const currentVar = await figma.variables.getVariableByIdAsync(
    variableAlias.id
  )
  const aliasCollection = await figma.variables.getVariableCollectionByIdAsync(currentVar?.variableCollectionId || '')
  const aliasCollectionName = getCollectionName(aliasCollection)
  return `{${aliasCollectionName}.${currentVar?.name.replace(/\//g, '.')}}`
}

const getLineHeightVariable = (value: number) => {
  const variables = variablesDb.font.line_height
  const valueToCheck = Number((value / 100).toFixed(2))
  const keyFound = Object.keys(variables).reduce((acc: string, key: string) => {
    if (acc) return acc
    if (variables[key].$value === valueToCheck) return key
    return ''
  }, '')
  
  return `{font.line_height.${keyFound}}`
}

const buildTokenData = async (modeId: string, variable: Variable, variables: TokenData = {}) => {
  set(variables, variable.name.split('/'), await getTokenValue(variable, modeId))
  return variables
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
    if (!['base-color', 'size', 'font', 'border', 'opacity'].includes(collectionName)) {
      variablesDb[collectionName][modeName] = variablesDb[collectionName][modeName] || {}
      variablesDb[collectionName][modeName] = result
      continue
    }
    
    variablesDb[collectionName] = result
  }
}


const createJsonFiles = () => {
  console.log('variablesDb', variablesDb)
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

  const fontJson = variablesDb['font']
  finalJSON['font.json'] = {
    file: 'font.json',
    content: {
      font: fontJson
    }
  }

  finalJSON['typography.json'] = {
    file: 'typography.json',
    content: {
      typography: textStylesJSON
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
  finalJSON['opacity.json'] = {
    file: 'base.json',
    content: {
      opacity: {
        level: opacityJson.level
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
  finalJSON['colors/dark-high-contrast.json'] = {
    file: 'dark-high-contrast.json',
    content: {
      color: {
        'dark-high-contrast': colorJson['dark-high-contrast']
      }
    }
  }
  finalJSON['colors/light-high-contrast.json'] = {
    file: 'light-high-contrast.json',
    content: {
      color: {
        'light-high-contrast': colorJson['light-high-contrast']
      }
    }
  }

  finalJSON['shadow.json'] = {
    file: 'shadow.json',
    content: effectStylesJSON
  }

  return JSON.parse(JSON.stringify(finalJSON).replaceAll('base-color', 'color'))
}

const processTextStyle = async (style: TextStyle) => {
  const boundVariables = style.boundVariables
  const tokenData = {
    $type: 'typography',
    $value: {
      fontFamily: await getVariableAlias(boundVariables?.fontFamily),
      fontSize: await getVariableAlias(boundVariables?.fontSize),
      fontWeight: await getVariableAlias(boundVariables?.fontWeight),
      lineHeight: getLineHeightVariable(style?.lineHeight.value),
    }
  }

  set(textStylesJSON, style.name.split('/'), tokenData)
}

const processEffectStyle = async (style: EffectStyle) => {
  const effects = style.effects[0]
  const token = {
    $type: 'shadow',
    $value: {
      color: rgbToHex(effects.color),
      offsetX: `${effects.offset.x}px`,
      offsetY: `${effects.offset.y}px`,
      blur: `${effects.radius}px`,
      spread: `${effects.spread}px`,
    },
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

  const textStyles = await figma.getLocalTextStylesAsync()
  for (const style of textStyles) {
    await processTextStyle(style)
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

  console.log('result', result)
  
  figma.ui.postMessage({ type: 'EXPORT_RESULT', tokens: result })
}

figma.ui.onmessage = (message) => {
  if (message.type === 'EXPORT') {
    exportToJSON()
  }
}

