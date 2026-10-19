function calculateProductionPlan(recipe, inventory = [], configuration = {}, targetQuantity) {
  const plannedQuantity = positiveNumber(targetQuantity, 0)
  const yieldQuantity = positiveNumber(recipe?.yieldQuantity, 1)
  if (plannedQuantity <= 0) throw new Error('Production quantity must be greater than 0')

  const batches = plannedQuantity / yieldQuantity
  const inventoryBySku = new Map(inventory.map((item) => [String(item.sku), item]))
  const productionSteps = (recipe?.processSteps || []).filter((step) => !step.optional)
  const expectedWastePercent = calculateExpectedWastePercent(recipe, productionSteps)
  const materials = aggregateMaterials([
    ...(recipe?.materials || []),
    ...productionSteps.flatMap((step) => step.materials || []),
  ])
  const requirements = materials.map((material) => {
    const item = inventoryBySku.get(String(material.sku))
    const baseRequiredQuantity = round(positiveNumber(material.quantity, 0) * batches)
    const wasteQuantity = round(baseRequiredQuantity * positiveNumber(material.wastePercent, 0) / 100)
    const requirement = round(baseRequiredQuantity + wasteQuantity)
    const onHandQuantity = round(numberOrZero(item?.onHand ?? item?.stock))
    const reservedQuantity = round(numberOrZero(item?.reserved))
    const incomingQuantity = round(numberOrZero(item?.incoming))
    const availableQuantity = round(Math.max(0, item?.available ?? onHandQuantity - reservedQuantity))
    const projectedAvailableQuantity = round(availableQuantity + incomingQuantity)
    const shortageQuantity = round(Math.max(0, requirement - projectedAvailableQuantity))
    const unitCost = round(numberOrZero(item?.price))

    return {
      sku: String(material.sku),
      item: String(material.item || item?.item || material.sku),
      unit: String(material.unit || 'unit'),
      baseRequiredQuantity,
      wasteQuantity,
      requiredQuantity: requirement,
      onHandQuantity,
      reservedQuantity,
      incomingQuantity,
      availableQuantity,
      projectedAvailableQuantity,
      shortageQuantity,
      availabilityStatus: shortageQuantity > 0 ? 'PURCHASE_REQUIRED' : availableQuantity >= requirement ? 'FULLY_AVAILABLE' : 'PARTIALLY_AVAILABLE',
      unitCost,
      materialCost: round(requirement * unitCost),
      materialType: material.materialType || 'material',
      substitutes: material.substitutes || [],
    }
  })

  const configuredLabor = mergeTimedAssignments(recipe?.labor, productionSteps.flatMap((step) => step.labor || []))
  const estimatedLabor = calculateEstimatedLabor(productionSteps, configuration.workers, plannedQuantity, batches)
  const hasStepCapacity = productionSteps.some((step) => numberOrZero(step.capacityPerHour) > 0)
  const useLaborEstimate = estimatedLabor.workerHours > 0 && (!configuredLabor.length || hasStepCapacity)
  const labor = useLaborEstimate
    ? { rows: estimatedLabor.rows, total: estimatedLabor.total }
    : calculateTimedResources(configuredLabor, configuration.workers, batches, plannedQuantity, 'labor')
  const machines = calculateTimedResources(mergeTimedAssignments(recipe?.machines, productionSteps.flatMap((step) => step.machines || [])), configuration.machines, batches, plannedQuantity, 'machine')
  const utilities = calculateUtilities(mergeUtilityAssignments(recipe?.utilities, productionSteps.flatMap((step) => step.utilities || [])), configuration.utilities, batches)
  const materialCost = round(requirements.reduce((total, row) => total + row.materialCost, 0))
  const packagingCost = round(requirements.filter((row) => row.materialType === 'packaging').reduce((total, row) => total + row.materialCost, 0))
  const stepDurationHours = round(productionSteps.reduce(
    (totalDuration, step) => totalDuration + numberOrZero(step.durationHours),
    0
  ) * batches)
  const capacityDurationHours = round(Math.max(
    0,
    ...productionSteps.map((step) => step.capacityPerHour > 0 ? plannedQuantity / Number(step.capacityPerHour) : 0),
    ...machines.rows.map((machine) => {
      const configured = findResource(configuration.machines, machine.name)
      return configured?.capacityPerHour > 0 ? plannedQuantity / Number(configured.capacityPerHour) : 0
    })
  ))
  const durationHours = Math.max(stepDurationHours, capacityDurationHours)
  const transport = round(numberOrZero(configuration.transportCostPerBatch) * batches)
  const overhead = calculateOverhead(configuration, plannedQuantity, batches, durationHours, materialCost + labor.total + machines.total + utilities.total + transport)
  const total = round(materialCost + labor.total + machines.total + utilities.total + transport + overhead)
  const totalMaterialInputQuantity = round(requirements.reduce((sum, row) => sum + row.requiredQuantity, 0))

  return {
    productSku: String(recipe?.productSku || ''),
    productName: String(recipe?.productName || ''),
    productUnit: String(recipe?.productUnit || 'piece'),
    plannedQuantity,
    yieldQuantity,
    batches: round(batches),
    durationHours: round(durationHours),
    expectedWasteQuantity: round(totalMaterialInputQuantity * expectedWastePercent / 100),
    expectedWastePercent,
    totalMaterialInputQuantity,
    materialsReady: requirements.every((row) => row.shortageQuantity <= 0),
    requirements,
    labor: labor.rows,
    laborEstimate: useLaborEstimate ? {
      workerHours: estimatedLabor.workerHours,
      workersRequired: estimatedLabor.workersRequired,
      shiftHours: estimatedLabor.shiftHours,
      averageHourlyRate: estimatedLabor.averageHourlyRate,
    } : undefined,
    machines: machines.rows,
    utilities: utilities.rows,
    cost: {
      material: materialCost,
      packaging: packagingCost,
      labor: labor.total,
      machine: machines.total,
      utility: utilities.total,
      overhead,
      transport,
      waste: 0,
      rework: 0,
      total,
      unit: round(total / plannedQuantity),
    },
  }
}

function calculateExpectedWastePercent(recipe, processSteps) {
  const losses = [
    positiveNumber(recipe?.expectedWastePercent, 0),
    ...processSteps.map((step) => positiveNumber(step.expectedWastePercent, 0)),
  ].map((percentage) => Math.min(100, percentage))
  const remainingFraction = losses.reduce((remaining, percentage) => remaining * (1 - percentage / 100), 1)
  return round((1 - remainingFraction) * 100)
}

function calculateWasteMetrics(inputQuantity, expectedWastePercent, actualWasteQuantity = 0) {
  const totalMaterialInputQuantity = round(positiveNumber(inputQuantity, 0))
  const actualWaste = round(positiveNumber(actualWasteQuantity, 0))
  return {
    totalMaterialInputQuantity,
    expectedWasteQuantity: round(totalMaterialInputQuantity * positiveNumber(expectedWastePercent, 0) / 100),
    actualWasteQuantity: actualWaste,
    actualWastePercent: totalMaterialInputQuantity > 0 ? round(actualWaste / totalMaterialInputQuantity * 100) : 0,
  }
}

function aggregateMaterials(materials = []) {
  const grouped = new Map()
  for (const material of materials) {
    const sku = String(material?.sku || '').trim()
    if (!sku) continue
    const key = `${sku}:${String(material.unit || 'unit').trim()}:${material.materialType || 'material'}`
    const current = grouped.get(key)
    if (current) {
      current.quantity = round(current.quantity + positiveNumber(material.quantity, 0))
      current.wastePercent = Math.max(current.wastePercent, positiveNumber(material.wastePercent, 0))
    } else {
      grouped.set(key, {
        ...material,
        sku,
        quantity: positiveNumber(material.quantity, 0),
        wastePercent: positiveNumber(material.wastePercent, 0),
      })
    }
  }
  return [...grouped.values()]
}

function mergeTimedAssignments(...groups) {
  const totals = new Map()
  groups.flat().forEach((assignment) => {
    const name = String(assignment?.name || '').trim()
    if (!name) return
    const current = totals.get(name) || 0
    totals.set(name, current + numberOrZero(assignment.hoursPerBatch))
  })
  return [...totals.entries()].map(([name, hoursPerBatch]) => ({ name, hoursPerBatch }))
}

function mergeUtilityAssignments(...groups) {
  const totals = new Map()
  groups.flat().forEach((assignment) => {
    const name = String(assignment?.name || '').trim()
    if (!name) return
    const current = totals.get(name) || 0
    totals.set(name, current + numberOrZero(assignment.quantityPerBatch))
  })
  return [...totals.entries()].map(([name, quantityPerBatch]) => ({ name, quantityPerBatch }))
}

function calculateTimedResources(assignments = [], resources = [], batches, plannedQuantity, resourceType) {
  const rows = assignments.map((assignment) => {
    const resource = findResource(resources, assignment.name)
    const hours = round(numberOrZero(assignment.hoursPerBatch) * batches)
    const cost = calculateResourceCost(resource, hours, batches, plannedQuantity, resourceType)
    const rate = hours > 0 ? round(cost / hours) : 0
    return { name: String(assignment.name), hours, rate, cost, rateType: resource?.rateType || resource?.costingMethod || 'hourly' }
  })
  return { rows, total: round(rows.reduce((total, row) => total + row.cost, 0)) }
}

function calculateEstimatedLabor(processSteps = [], workers = [], plannedQuantity, batches) {
  const activeWorkers = (workers || []).filter((worker) => worker.active !== false)
  const workerRates = activeWorkers.map(hourlyLaborRate).filter((rate) => rate > 0)
  const averageHourlyRate = workerRates.length
    ? round(workerRates.reduce((total, rate) => total + rate, 0) / workerRates.length)
    : 0
  const availableShifts = activeWorkers
    .map((worker) => positiveNumber(worker.availableHoursPerDay, 8))
    .filter((hours) => hours > 0)
  const shiftHours = availableShifts.length
    ? round(availableShifts.reduce((total, hours) => total + hours, 0) / availableShifts.length)
    : 8
  const rows = processSteps.map((step) => {
    const capacityPerHour = positiveNumber(step.capacityPerHour, 0)
    const hours = round(capacityPerHour > 0
      ? plannedQuantity / capacityPerHour
      : positiveNumber(step.durationHours, 0) * batches)
    return {
      name: String(step.name || 'Production step'),
      hours,
      rate: averageHourlyRate,
      cost: round(hours * averageHourlyRate),
      rateType: 'estimated',
    }
  }).filter((row) => row.hours > 0)
  const workerHours = round(rows.reduce((total, row) => total + row.hours, 0))
  return {
    rows,
    workerHours,
    workersRequired: workerHours > 0 ? Math.ceil(workerHours / shiftHours) : 0,
    shiftHours,
    averageHourlyRate,
    total: round(rows.reduce((total, row) => total + row.cost, 0)),
  }
}

function hourlyLaborRate(worker = {}) {
  const rateType = String(worker.rateType || 'hourly').toLowerCase()
  const configuredRate = positiveNumber(worker.rate ?? worker.hourlyRate, 0)
  if (rateType === 'monthly') return configuredRate / 176
  if (rateType === 'daily') return configuredRate / 8
  if (rateType === 'hourly') return configuredRate
  return 0
}

function calculateResourceCost(resource = {}, hours, batches, plannedQuantity, resourceType) {
  const type = String(resourceType === 'machine' ? resource.costingMethod : resource.rateType || 'hourly').toLowerCase()
  const configuredRate = numberOrZero(resource.rate ?? resource.hourlyRate)
  if (resourceType === 'machine' && type === 'depreciation') {
    const depreciable = Math.max(0, numberOrZero(resource.purchasePrice) - numberOrZero(resource.residualValue))
    const lifeHours = Math.max(1, numberOrZero(resource.usefulLifeYears) * 12 * 176)
    return round(hours * depreciable / lifeHours)
  }
  if (type === 'monthly') return round(hours * configuredRate / 176)
  if (type === 'daily') return round(hours * configuredRate / 8)
  if (type === 'per_product' || type === 'quantity') return round(plannedQuantity * configuredRate)
  if (type === 'per_batch' || type === 'batch') return round(batches * configuredRate)
  return round(hours * configuredRate)
}

function calculateOverhead(configuration, plannedQuantity, batches, durationHours, directCost) {
  const base = numberOrZero(configuration?.overheadRatePerUnit) * plannedQuantity
  const configured = (configuration?.overheadCosts || []).filter((entry) => entry?.active !== false).reduce((total, entry) => {
    const amount = numberOrZero(entry.amount)
    const method = String(entry.allocationMethod || 'per_unit').toLowerCase()
    if (method === 'per_batch') return total + amount * batches
    if (method === 'per_production_hour') return total + amount * durationHours
    if (method === 'percentage') return total + directCost * amount / 100
    if (method === 'fixed') return total + amount
    return total + amount * plannedQuantity
  }, 0)
  return round(base + configured)
}

function calculateUtilities(assignments = [], utilities = [], batches) {
  const rows = assignments.map((assignment) => {
    const utility = findResource(utilities, assignment.name)
    const quantity = round(numberOrZero(assignment.quantityPerBatch) * batches)
    const rate = round(numberOrZero(utility?.rate))
    return { name: String(assignment.name), quantity, unit: String(utility?.unit || 'unit'), rate, cost: round(quantity * rate) }
  })
  return { rows, total: round(rows.reduce((total, row) => total + row.cost, 0)) }
}

function findResource(resources = [], name) {
  const wanted = String(name || '').trim().toLowerCase()
  return resources.find((resource) => String(resource.name || '').trim().toLowerCase() === wanted)
}

function positiveNumber(value, fallback) {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback
}

function numberOrZero(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function round(value) {
  return Number(Number(value || 0).toFixed(4))
}

module.exports = { calculateProductionPlan, calculateWasteMetrics }
