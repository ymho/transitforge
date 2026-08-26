import type { Train } from "@raiquora/train/train";

export interface TrainTitle {
  badge: string;
  main: string;
  suffix?: string;
}

export function trainTitleFor(
  train: Pick<Train, "service_type" | "train_name" | "destination_station">,
): TrainTitle {
  const serviceLabel = trainServiceLabelFor(train);

  if (train.service_type.includes("特急") && train.train_name) {
    return {
      badge: serviceLabel,
      main: formatNamedService(train.train_name),
    };
  }

  return {
    badge: serviceLabel,
    main: train.destination_station,
    suffix: "行き",
  };
}

export function trainServiceLabelFor(
  train: Pick<Train, "service_type" | "train_name">,
): string {
  if (train.service_type.includes("新幹線") && train.train_name) {
    return train.train_name;
  }

  return train.service_type || "列車";
}

function formatNamedService(trainName: string): string {
  return trainName.replace(/^(.*\D)(\d+号)$/u, "$1 $2");
}
