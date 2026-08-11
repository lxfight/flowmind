const modalLayers: symbol[] = []

export function registerModalLayer(layer: symbol) {
  modalLayers.push(layer)
  return () => {
    const index = modalLayers.lastIndexOf(layer)
    if (index >= 0) modalLayers.splice(index, 1)
  }
}

export function isTopModalLayer(layer: symbol) {
  return modalLayers[modalLayers.length - 1] === layer
}
