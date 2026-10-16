import * as React from "react";
import { cn } from "@/shared/lib/utils";
import { Card, CardHeader, CardTitle, CardContent } from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { Camera, Image as ImageIcon, XCircle, CheckCircle2, AlertTriangle, ArrowRightLeft } from "lucide-react";
import type { QcResult } from "@/shared/types/database.types";

export interface QcInspectionFormProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onSubmit"> {
  batchNumber: string;
  stageName: string;
  onSubmit: (data: {
    result: QcResult;
    defectCategory?: string;
    notes: string;
    photoFile?: File | null;
    reworkDestination?: string;
  }) => void;
  isSubmitting?: boolean;
}

const DEFECT_CATEGORIES = [
  "Porosity / Pitting",
  "Scratches / Surface Finish",
  "Dimension Tolerance",
  "Assembly Alignment",
  "Stone Setting Issue",
  "Weight Discrepancy",
  "Other",
];

const REWORK_DESTINATIONS = [
  "Casting",
  "Pre-Polish",
  "Wax Assembly",
  "Laser Decoration",
  "Scrap / Melt",
];

export function QcInspectionForm({
  batchNumber,
  stageName,
  onSubmit,
  isSubmitting,
  className,
  ...props
}: QcInspectionFormProps) {
  const [result, setResult] = React.useState<QcResult | null>(null);
  const [defectCategory, setDefectCategory] = React.useState<string>("");
  const [notes, setNotes] = React.useState<string>("");
  const [reworkDestination, setReworkDestination] = React.useState<string>("");
  const [photo, setPhoto] = React.useState<File | null>(null);

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!result) return;

    onSubmit({
      result,
      defectCategory: result !== "pass" ? defectCategory : undefined,
      notes,
      photoFile: photo,
      reworkDestination: result === "fail" ? reworkDestination : undefined,
    });
  };

  const handlePhotoClick = () => {
    fileInputRef.current?.click();
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setPhoto(e.target.files[0]);
    }
  };

  const isFail = result === "fail";
  const isCondPass = result === "conditional_pass";

  return (
    <Card className={cn("overflow-hidden md:rounded-xl touch-manipulation", className)} {...props}>
      <CardHeader className="bg-muted/30 border-b p-4 md:p-6">
        <div className="flex justify-between items-start">
          <CardTitle className="text-xl md:text-2xl font-bold flex flex-col gap-1">
            <span>QC Inspection</span>
            <span className="font-mono text-primary text-base md:text-lg">{batchNumber}</span>
          </CardTitle>
          <span className="bg-secondary text-secondary-foreground text-xs font-semibold px-2.5 py-1 rounded-md">
            {stageName}
          </span>
        </div>
      </CardHeader>

      <CardContent className="p-4 md:p-6">
        <form onSubmit={handleSubmit} className="space-y-8">

          <div className="space-y-4">
            <Label className="text-sm md:text-base font-semibold text-muted-foreground uppercase tracking-wider">
              Inspection Result
            </Label>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Button
                type="button"
                variant={result === "pass" ? "default" : "outline"}
                className={cn("h-16 md:h-20 text-lg md:text-xl font-bold", result === "pass" && "bg-green-600 hover:bg-green-700 text-white")}
                onClick={() => setResult("pass")}
              >
                <CheckCircle2 className="w-6 h-6 mr-2" />
                PASS
              </Button>
              <Button
                type="button"
                variant={result === "conditional_pass" ? "default" : "outline"}
                className={cn("h-16 md:h-20 text-lg md:text-xl font-bold", result === "conditional_pass" && "bg-orange-500 hover:bg-orange-600 text-white")}
                onClick={() => setResult("conditional_pass")}
              >
                <AlertTriangle className="w-6 h-6 mr-2" />
                CONDITIONAL
              </Button>
              <Button
                type="button"
                variant={result === "fail" ? "default" : "outline"}
                className={cn("h-16 md:h-20 text-lg md:text-xl font-bold", result === "fail" && "bg-red-600 hover:bg-red-700 text-white")}
                onClick={() => setResult("fail")}
              >
                <XCircle className="w-6 h-6 mr-2" />
                FAIL
              </Button>
            </div>
          </div>

          {(isFail || isCondPass) && (
            <div className="space-y-6 animate-in fade-in slide-in-from-top-4 duration-300">
              <div className="space-y-3">
                <Label className="text-sm md:text-base font-semibold text-muted-foreground uppercase tracking-wider">
                  Defect Category
                </Label>
                <div className="flex flex-wrap gap-2">
                  {DEFECT_CATEGORIES.map((cat) => (
                    <Button
                      key={cat}
                      type="button"
                      variant={defectCategory === cat ? "secondary" : "outline"}
                      className={cn("h-12 md:h-14 px-4 text-sm md:text-base", defectCategory === cat && "ring-2 ring-primary")}
                      onClick={() => setDefectCategory(cat)}
                    >
                      {cat}
                    </Button>
                  ))}
                </div>
              </div>

              {isFail && (
                <div className="space-y-3 bg-red-50 dark:bg-red-950/20 p-4 rounded-xl border border-red-100 dark:border-red-900/50">
                  <Label className="text-sm md:text-base font-semibold text-red-800 dark:text-red-300 uppercase tracking-wider flex items-center gap-2">
                    <ArrowRightLeft className="w-4 h-4" />
                    Rework Destination
                  </Label>
                  <p className="text-xs text-red-600/80 dark:text-red-400/80 mb-2">
                    Select where this batch should be routed for rework.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {REWORK_DESTINATIONS.map((dest) => (
                      <Button
                        key={dest}
                        type="button"
                        variant={reworkDestination === dest ? "destructive" : "outline"}
                        className={cn("h-10 md:h-12 px-4")}
                        onClick={() => setReworkDestination(dest)}
                      >
                        {dest}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <Label htmlFor="notes" className="text-sm md:text-base font-semibold text-muted-foreground uppercase tracking-wider">
                    Rejection / Condition Details
                  </Label>
                  <Button type="button" variant="ghost" size="sm" onClick={handlePhotoClick} className="text-primary gap-1">
                    <Camera className="w-4 h-4" />
                    Add Photo
                  </Button>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    ref={fileInputRef}
                    className="hidden"
                    onChange={handlePhotoChange}
                  />
                </div>

                {photo && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-3 bg-muted/50 p-2 rounded-lg border text-sm">
                      <ImageIcon className="w-5 h-5 text-muted-foreground" />
                      <span className="truncate flex-1 font-medium">{photo.name}</span>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setPhoto(null)}>
                        <XCircle className="w-4 h-4" />
                      </Button>
                    </div>
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 italic">
                      ⚠️ Eslatma: Xavfsiz rasm saqlash (Supabase Storage) hozirda ulanmagan. Tekshiruv dalolatnomasi matnli maʼlumotlar bilan saqlanadi.
                    </p>
                  </div>
                )}

                <textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder="Describe the defect or conditions for passing..."
                  required={isFail}
                />
              </div>
            </div>
          )}

          <div className="pt-4 flex justify-end">
            <Button
              type="submit"
              size="lg"
              disabled={isSubmitting || !result || (isFail && (!defectCategory || !reworkDestination || !notes)) || (isCondPass && (!defectCategory || !notes))}
              className="w-full md:w-auto min-w-[200px] h-14 md:h-16 text-lg font-semibold"
            >
              {isSubmitting ? "Submitting..." : "Submit Inspection"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
