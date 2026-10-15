import * as React from "react";
import { Card, CardContent } from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { Play, Pause, AlertCircle } from "lucide-react";
import { BatchProgressCard, type BatchProgressInfo } from "./BatchProgressCard";
import { HandoverWeightForm, type HandoverFormData } from "./HandoverWeightForm";
import { StageLossWarning } from "./StageLossWarning";
import { StageQueueBoard, type QueuedBatch } from "./StageQueueBoard";

export interface ActiveOperationInfo {
  batchId: string;
  expectedLossGrams: number;
  toleranceGrams: number;
  status: "in_progress" | "paused";
}

export interface OperatorTouchPanelProps {
  operatorName: string;
  departmentName: string;
  activeBatch?: BatchProgressInfo;
  activeOperation?: ActiveOperationInfo;
  queuedBatches: QueuedBatch[];
  onStartBatch: (batchId: string) => void;
  onPauseBatch: (batchId: string, reason: string) => void;
  onResumeBatch: (batchId: string) => void;
  onCompleteBatch: (batchId: string, data: HandoverFormData) => void;
}

export function OperatorTouchPanel({
  operatorName,
  departmentName,
  activeBatch,
  activeOperation,
  queuedBatches,
  onStartBatch,
  onPauseBatch,
  onResumeBatch,
  onCompleteBatch,
}: OperatorTouchPanelProps) {
  const [activeTab, setActiveTab] = React.useState<string>(activeBatch ? "active" : "queue");
  const [handoverWeight, setHandoverWeight] = React.useState<number | null>(null);

  // Auto-switch tabs based on active batch state
  React.useEffect(() => {
    if (activeBatch) {
      setActiveTab("active");
    } else {
      setActiveTab("queue");
    }
  }, [activeBatch]);

  return (
    <div className="flex h-full min-h-[600px] flex-col space-y-6">
      <header className="flex items-center justify-between rounded-lg border bg-card p-4 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{departmentName} Dashboard</h1>
          <p className="text-muted-foreground">Operator: {operatorName}</p>
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 space-y-4">
        <TabsList className="grid w-full grid-cols-2 lg:w-[400px]">
          <TabsTrigger value="active" disabled={!activeBatch}>Active Task</TabsTrigger>
          <TabsTrigger value="queue">Queue ({queuedBatches.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="mt-0">
          <StageQueueBoard
            stageName={departmentName}
            batches={queuedBatches}
            onSelectBatch={onStartBatch}
            className="border-none shadow-none bg-transparent"
          />
        </TabsContent>

        <TabsContent value="active" className="mt-0 space-y-6">
          {activeBatch && activeOperation ? (
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-6">
                <BatchProgressCard batch={activeBatch} />

                <Card>
                  <CardContent className="p-6">
                    <div className="flex flex-col gap-4">
                      {activeOperation.status === "paused" ? (
                        <Button size="lg" onClick={() => onResumeBatch(activeOperation.batchId)} className="h-16 text-lg">
                          <Play className="mr-2 h-6 w-6" /> Resume Operation
                        </Button>
                      ) : (
                        <Button size="lg" variant="secondary" onClick={() => onPauseBatch(activeOperation.batchId, "Lunch Break")} className="h-16 text-lg">
                          <Pause className="mr-2 h-6 w-6" /> Pause Operation
                        </Button>
                      )}
                      <Button variant="outline" size="lg" className="h-16 text-lg text-destructive hover:text-destructive">
                         <AlertCircle className="mr-2 h-6 w-6" /> Report Issue
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-6">
                <div className="rounded-lg border bg-card p-6 shadow-sm">
                  <h3 className="mb-4 text-xl font-semibold">Complete Operation</h3>

                  {handoverWeight !== null && (
                    <StageLossWarning
                      className="mb-6"
                      expectedLossGrams={activeOperation.expectedLossGrams}
                      toleranceGrams={activeOperation.toleranceGrams}
                      actualLossGrams={100 - handoverWeight} // Dummy calculation, assume start weight was 100 for now. Real implementation needs start weight.
                    />
                  )}

                  <HandoverWeightForm
                    onSubmit={(data) => {
                      setHandoverWeight(data.weightGrams);
                      onCompleteBatch(activeOperation.batchId, data);
                    }}
                  />
                </div>
              </div>
            </div>
          ) : (
             <div className="flex h-64 items-center justify-center rounded-lg border border-dashed">
                <p className="text-xl text-muted-foreground">No active task. Select a batch from the queue to start.</p>
             </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
