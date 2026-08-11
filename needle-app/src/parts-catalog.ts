/** Part metadata from Unity JetEngine.prefab / ARPartDefinition */
export type PartDef = {
  uid: string;
  meshNames: string[];
  title: string;
  description: string;
};

export const PARTS: PartDef[] = [
  {
    uid: "Outer_Nozzle",
    meshNames: ["Outer_Nozzle"],
    title: "Outer Nozzle",
    description: "The outer nozzle of the jet engine.",
  },
  {
    uid: "Support_Ribs",
    meshNames: ["Support_Ribs"],
    title: "Support Ribs",
    description: "The support ribs of the outer nozzle.",
  },
  {
    uid: "Fan_Rim",
    meshNames: ["Fan_Rim"],
    title: "Fan Rim",
    description: "The fan rim of the turbo fan.",
  },
  {
    uid: "Turbofan",
    meshNames: ["Turbofan"],
    title: "Turbofan",
    description: "The jet engine intake turbofan.",
  },
  {
    uid: "Core_Shell",
    meshNames: ["Core_Shell"],
    title: "Core Shell",
    description: "The core shell of the turbines.",
  },
  {
    uid: "High_Pressure",
    meshNames: ["High_Pressure_compresor", "Hi_pressure_blades", "Hi_pressure_blades2"],
    title: "High Pressure Comp.",
    description: "The high pressure compressor.",
  },
  {
    uid: "Turbine_Shaft",
    meshNames: ["Turbine_Shaft"],
    title: "Turbine Shaft",
    description: "The jet engine turbine shaft.",
  },
  {
    uid: "Turbine_Blades",
    meshNames: ["Turbine_Blades"],
    title: "Turbine Blades",
    description: "The jet engine turbine blades.",
  },
  {
    uid: "Inner_Nozzle",
    meshNames: ["Inner_Nozzle"],
    title: "Inner Nozzle",
    description: "The inner nozzle of the jet engine.",
  },
  {
    uid: "Low_PC_Body",
    meshNames: ["Low_PC_Body", "LP_blades"],
    title: "Low Pressure Comp.",
    description: "The low pressure compressor body and blades.",
  },
  {
    uid: "Low_presure_ribs_and_shell",
    meshNames: ["Low_presure_ribs_and_shell"],
    title: "Low Pressure Shell",
    description: "The low pressure compressor ribs and shell.",
  },
];

export function findPartDefByObjectName(name: string | undefined | null): PartDef | null {
  if (!name) return null;
  const n = name.trim();
  return (
    PARTS.find((p) => p.meshNames.some((m) => m === n || n.includes(m) || m.includes(n))) ||
    null
  );
}

/** Walk up parents until a known ARPart name matches (Blender nesting). */
export function findPartDefFromObject(obj: { name?: string; parent?: any } | null): PartDef | null {
  let cur: any = obj;
  while (cur) {
    const def = findPartDefByObjectName(cur.name);
    if (def) return def;
    cur = cur.parent;
  }
  return null;
}
