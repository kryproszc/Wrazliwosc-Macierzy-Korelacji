%load_ext autoreload
%autoreload 2

from mack import kalibracja_macka


import pandas as pd
import numpy as np

# Wczytanie trójkąta z Excela
df = pd.read_excel(
    r"",
    sheet_name=0,
    index_col=0
)

# Konwersja do NumPy
triangle = df.to_numpy(dtype=np.float64)


from mack import kalibracja_macka
L, f, fr, sigma2, nf, ns = kalibracja_macka(
    triangle,
    wagi
)

from mack import calculate_C_future

C_future = calculate_C_future(triangle, f)


v = np.array([
    np.sum(triangle[:21-j, j] * wagi[:21-j, j])
    for j in range(21)
], dtype=np.float64)




from mack import dopasuj_ldf

ldf, b0, b1, tail, wynik = dopasuj_ldf(
    fr,
    v=v,
    curve_type="weibull",
    fit_from=4,
    fit_to=15,
    smooth_from=3,
    smooth_to=21,
    tail_length=5
)



# Wagi regresji sigma
v_sigma = np.maximum(ns - 1, 0).astype(np.float64)
from mack import dopasuj_sigma

sigma2_fit, b0, b1, wynik = dopasuj_sigma(
    sigma2=sigma2,
    curve_type="weibull",
    fit_from=5,
    fit_to=14,
    smooth_from=5,
    smooth_to=21,
    v=v_sigma
)

print(f"b0 = {b0:.15f}")
print(f"b1 = {b1:.15f}")





print(sigma2_fit)
