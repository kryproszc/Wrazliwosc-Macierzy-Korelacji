import pandas as pd
import numpy as np

excel_path = r"D:\Aplikacja_wizualna — kopia (2) — kopia\dane\simulation_inputs.xlsx"

simulation_inputs = pd.read_excel(excel_path, index_col="parameter")

dev_inc = simulation_inputs.loc["dev_inc"].dropna().to_numpy(dtype=float)
sigma_inc = simulation_inputs.loc["sigma_inc"].dropna().to_numpy(dtype=float)
sd_inc = simulation_inputs.loc["sd_inc"].dropna().to_numpy(dtype=float)
rj = simulation_inputs.loc["rj"].dropna().to_numpy(dtype=float)
varj = simulation_inputs.loc["varj"].dropna().to_numpy(dtype=float)
