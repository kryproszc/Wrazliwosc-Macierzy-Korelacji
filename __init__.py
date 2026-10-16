
import numpy as np
import pandas as pd
from mack import krzywa_ldf

# Parametry Weibulla odtworzone z zakładu

# 1. Surowe współczynniki Chain Ladder
LDF_zaklad = np.array(fr, dtype=np.float64, copy=True)

# 2. Wygładzenie współczynników 4–21
j_smooth = np.arange(4, 22, dtype=np.float64)

LDF_zaklad[3:21] = krzywa_ldf(
    j_smooth,
    b0_zaklad,
    b1_zaklad,
    curve_type="weibull"
)

# 3. Tail z pięciu okresów: 22–26
j_tail = np.arange(22, 27, dtype=np.float64)

tail_zaklad = float(np.prod(
    krzywa_ldf(
        j_tail,
        b0_zaklad,
        b1_zaklad,
        curve_type="weibull"
    )
))

#from mack import calculate_paid_fit

paid_fit_zaklad, BEL_zaklad = calculate_paid_fit(
    triangle=triangle,
    ldf=LDF_zaklad,
    tail=tail_zaklad,
    inflacja=inflacja,
    start_year=2003
)

print("Wymiary trójkąta:", paid_fit_zaklad.shape)
print(f"BEL = {BEL_zaklad:,.2f}")


