#!/usr/bin/env python3
"""Out-of-time agreement against classified maps, not field validation.
Uses cached inputs from prepare_future_data.py; no 2025 occupation mask leaks in.
"""
import argparse,json
from pathlib import Path
import numpy as np
from scipy.ndimage import distance_transform_edt

def main():
    parser=argparse.ArgumentParser();parser.add_argument("--cache-dir",type=Path,default=Path(__file__).resolve().parents[2]/"research/raw");args=parser.parse_args()
    summaries=[]
    for site in ["el-uvito","la-palma"]:
        d=json.loads((args.cache_dir/f"{site}-validation-input.json").read_text());shape=(d["height"],d["width"])
        inside=np.array(d["insideFraction"]).reshape(shape)>.99
        a,b,c=[np.array(d["classes"][str(y)]).reshape(shape) for y in [2021,2023,2025]]
        valid=inside & ~np.isin(a,[0,10]) & ~np.isin(b,[0,10]) & ~np.isin(c,[0,10])
        prior=max(0,int(((b==7)&valid).sum()-((a==7)&valid).sum()))
        distance=distance_transform_edt(b!=7,sampling=(d["cellDepth"],d["cellWidth"]))
        slope=np.array(d["slope"]).reshape(shape)
        eligible=valid & np.isin(b,[2,5,8,11]) & (slope<=25) & (distance<=800)
        score=.58*np.exp(-distance/500)+.24*(1-slope/40)
        order=np.argsort(score.ravel())[::-1]; selected=[i for i in order if eligible.ravel()[i]][:prior]
        predicted=np.zeros(a.size,bool);predicted[selected]=True;predicted=predicted.reshape(shape)
        observed=valid & (b!=7) & (c==7)
        tp=int((predicted&observed).sum());fp=int((predicted&~observed).sum());fn=int((~predicted&observed).sum())
        cells=[int(((v==7)&valid).sum()) for v in [a,b,c]]
        trees=[int(((v==2)&valid).sum()) for v in [a,b,c]]
        predicted_trees=trees[1]*(trees[1]/trees[0] if trees[0] else 1)
        summaries.append({"site":site,"reference":"2023–2025 classified land-cover change","training":"2021–2023",
          "predictedNewCells":len(selected),"referenceNewCells":int(observed.sum()),"hits":tp,"falseAlarms":fp,"misses":fn,
          "figureOfMerit":round(tp/(tp+fp+fn),4) if tp+fp+fn else 0,
          "precision":round(tp/(tp+fp),4) if tp+fp else 0,"recall":round(tp/(tp+fn),4) if tp+fn else 0,
          "builtCells2021_2023_2025":cells,"treeCells2021_2023_2025":trees,
          "treeAreaExtrapolationErrorPercent":round(100*(predicted_trees-trees[2])/trees[2],1) if trees[2] else None,
          "interpretation":"Map-agreement diagnostic only. Classifier errors and census uncertainty are not quantified."})
    out=Path(__file__).resolve().parents[1]/"docs/historical-check.json";out.parent.mkdir(exist_ok=True);out.write_text(json.dumps(summaries,indent=2))
    print(json.dumps(summaries,indent=2))
if __name__=="__main__":main()
