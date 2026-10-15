/**
 * Machine Scheduling & Station Queue Allocation
 *
 * Configured specifically for factory machinery profile:
 * - 8 Laser machines (Laser #1 to #8) for engraving, hallmarking, and micro-welding
 * - 2 Casting stations (Casting #1, #2) for vacuum gold casting
 * - Load balancing, queue tracking, and bottleneck detection
 */

export interface MachineStation {
  id: string;
  code: string;
  name: string;
  type: "LASER" | "CASTING" | "POLISHING" | "OTHER";
  department: string;
  status: "IDLE" | "BUSY" | "MAINTENANCE" | "OFFLINE";
  dailyCapacityPcs: number;
  currentBatchNo: string | null;
  activeTaskId: string | null;
  assignedOperator: string | null;
}

export interface MachineQueueTask {
  taskId: string;
  batchNo: string;
  modelCode?: string;
  qtyPcs: number;
  weightGram: number;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  assignedMachineId?: string | null;
  status: "QUEUED" | "IN_PROGRESS" | "COMPLETED";
  queuedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

/** Standard 8 Laser Machines initialized for Goldia Factory */
export function getStandardGoldiaStations(): MachineStation[] {
  const stations: MachineStation[] = [];

  // 2 Casting Stations
  stations.push({
    id: "cast-01",
    code: "CAST-01",
    name: "Vacuum Casting Machine #1 (Indutherm)",
    type: "CASTING",
    department: "Quyish",
    status: "IDLE",
    dailyCapacityPcs: 400,
    currentBatchNo: null,
    activeTaskId: null,
    assignedOperator: null,
  });
  stations.push({
    id: "cast-02",
    code: "CAST-02",
    name: "Vacuum Casting Machine #2 (Schultheiss)",
    type: "CASTING",
    department: "Quyish",
    status: "IDLE",
    dailyCapacityPcs: 400,
    currentBatchNo: null,
    activeTaskId: null,
    assignedOperator: null,
  });

  // 8 Laser Machines
  for (let i = 1; i <= 8; i++) {
    const padded = String(i).padStart(2, "0");
    stations.push({
      id: `laser-${padded}`,
      code: `LASER-${padded}`,
      name: `Laser Station #${i} (Fiber 50W)`,
      type: "LASER",
      department: "Lazer",
      status: "IDLE",
      dailyCapacityPcs: 250,
      currentBatchNo: null,
      activeTaskId: null,
      assignedOperator: null,
    });
  }

  return stations;
}

/**
 * Finds the optimal station with the lowest active queue load for a given machinery type.
 */
export function findOptimalStation(
  stations: MachineStation[],
  stationType: "LASER" | "CASTING",
  activeTasks: MachineQueueTask[]
): MachineStation | null {
  const matchingStations = stations.filter(
    (s) => s.type === stationType && s.status !== "MAINTENANCE" && s.status !== "OFFLINE"
  );
  if (matchingStations.length === 0) return null;

  // First priority: any station that is currently IDLE
  const idleStation = matchingStations.find((s) => s.status === "IDLE");
  if (idleStation) return idleStation;

  // Otherwise, find station with least queued pieces
  let bestStation = matchingStations[0]!;
  let minLoad = Infinity;

  for (const st of matchingStations) {
    const stationLoad = activeTasks
      .filter((t) => t.assignedMachineId === st.id && t.status !== "COMPLETED")
      .reduce((sum, t) => sum + t.qtyPcs, 0);

    if (stationLoad < minLoad) {
      minLoad = stationLoad;
      bestStation = st;
    }
  }

  return bestStation;
}

/**
 * Allocates a production task to a machine station.
 */
export function assignTaskToStation(
  task: MachineQueueTask,
  station: MachineStation,
  operatorName?: string
): { updatedTask: MachineQueueTask; updatedStation: MachineStation } {
  const updatedTask: MachineQueueTask = {
    ...task,
    assignedMachineId: station.id,
    status: "IN_PROGRESS",
    startedAt: new Date().toISOString(),
  };

  const updatedStation: MachineStation = {
    ...station,
    status: "BUSY",
    currentBatchNo: task.batchNo,
    activeTaskId: task.taskId,
    assignedOperator: operatorName ?? station.assignedOperator,
  };

  return { updatedTask, updatedStation };
}

/**
 * Completes a machine station task and marks station IDLE.
 */
export function completeStationTask(
  task: MachineQueueTask,
  station: MachineStation
): { updatedTask: MachineQueueTask; updatedStation: MachineStation } {
  const updatedTask: MachineQueueTask = {
    ...task,
    status: "COMPLETED",
    completedAt: new Date().toISOString(),
  };

  const updatedStation: MachineStation = {
    ...station,
    status: "IDLE",
    currentBatchNo: null,
    activeTaskId: null,
  };

  return { updatedTask, updatedStation };
}
