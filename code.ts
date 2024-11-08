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

const variablesDb = {} as {
  [key in keyof typeof COLLECTION_MAPPING]: Record<string, Record<string, Record<string, Token>>> | Record<string, Record<string, Token>>
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

const getCollectionName = (collection: VariableCollection | null) => {
  if (!collection) {
    return ''
  }

  return COLLECTION_MAPPING[collection.name.split('.')[1].trim()]
}

const isVariableAlias = (value: VariableValue) => {
  return typeof value === 'object' && 'type' in value && 'id' in value
}

const getVariablesFromCollection = async (modeId: string, variableIds: string[]) => {
  const variables = {} as Record<string, Record<string, Token>>
  for (const variableId of variableIds) {
    const variable = await figma.variables.getVariableByIdAsync(variableId)

    if (!variable) {
      continue;
    }

    const { resolvedType } = variable
    const value = variable.valuesByMode[modeId]
    if (value !== undefined && ['COLOR', 'FLOAT'].includes(resolvedType)) {
      const [group, name] = variable.name.split('/')
      variables[group] = variables[group] || {}
      const token = {
        // name: name,
        $type: resolvedType === 'COLOR' ? 'color' : 'number',
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
        // token.alias = currentVar?.id;
      } else {
        // token.id = variable.id;
        token.$value = resolvedType === 'COLOR' ? rgbToHex(value) : value;
      }
      variables[group][name] = token
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

async function exportToJSON() {
  // VariableCollection
  // https://www.figma.com/plugin-docs/api/VariableCollection/
  const collections = await figma.variables.getLocalVariableCollectionsAsync()
  for (const collection of collections) {
    await processCollection(collection)
  }
  
  figma.ui.postMessage({ type: 'EXPORT_RESULT', variables: variablesDb })
}

figma.ui.onmessage = (message) => {
  if (message.type === 'EXPORT') {
    exportToJSON()
  }
}

