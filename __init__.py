import numpy as np
from numba import njit

@njit
def calculate_sigma(p_ij, l_ij, w_ij, dev_j):

    n_rows, n_cols = l_ij.shape

    sigmas = np.empty(n_cols, dtype=np.float64)
    sds = np.empty(n_cols, dtype=np.float64)

    for j in range(n_cols):

        dev = dev_j[j]

        num = 0.0
        den = 0.0
        den_sd = 0.0
        cnt = 0

        for i in range(n_rows):

            w = w_ij[i, j]
            p = p_ij[i, j]
            l = l_ij[i, j]

            if (
                np.isfinite(w)
                and np.isfinite(p)
                and np.isfinite(l)
                and w > 0.0
                and p > 0.0
            ):

                diff = l - dev

                num += w * p * diff * diff
                den += w
                den_sd += w * p
                cnt += 1

        # =====================================
        # 1. ESTYMACJA WARIANCJI
        # =====================================

        if cnt >= 3 and den > 1.0:

            sigma = num / (den - 1.0)

        # =====================================
        # 2. EKSTRAPOLACJA WARIANCJI
        # =====================================

        elif j >= 2:

            sigma_1 = sigmas[j - 1]
            sigma_2 = sigmas[j - 2]

            if sigma_1 > 0.0 and sigma_2 > 0.0:

                sigma = min(
                    sigma_1 ** 2 / sigma_2,
                    sigma_1,
                    sigma_2
                )

            elif sigma_1 > 0.0:

                sigma = sigma_1

            elif sigma_2 > 0.0:

                sigma = sigma_2

            else:

                sigma = 0.0

        else:

            sigma = 0.0

        # =====================================
        # 3. ODCHYLENIE STANDARDOWE
        # =====================================

        if den_sd > 0.0:

            sd_val = sigma / den_sd
            sd = np.sqrt(max(sd_val, 0.0))

        else:

            sd = 0.0

        sigmas[j] = sigma
        sds[j] = sd

    return sigmas, sds
