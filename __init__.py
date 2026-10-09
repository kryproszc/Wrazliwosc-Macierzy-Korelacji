import numpy as np
from numba import njit

@njit
def calculate_sigma(p_ij, l_ij, w_ij, dev_j):

    n_rows, n_cols = l_ij.shape

    sigmas = np.empty(n_cols)
    sds = np.empty(n_cols)

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

            if not np.isnan(w):

                diff = l - dev

                num += w * p * diff * diff
                den += w
                den_sd += w * p
                cnt += 1

        # Oryginalny wzór na sigma
        if den > 1.0 and num > 0:
            sigma = num / (den - 1.0)
        else:
            sigma = 0.0

        # Oryginalny wzór na SD
        sd_val = sigma / den_sd if den_sd > 0.0 else 0.0

        sigmas[j] = sigma
        sds[j] = np.sqrt(sd_val)

        # Diagnostyka wszystkich okresów
        print("-----------------------------")
        print("j =", j)
        print("dev =", dev)
        print("num =", num)
        print("den =", den)
        print("den_sd =", den_sd)
        print("cnt =", cnt)
        print("sigma =", sigma)
        print("sd =", sds[j])

    # Znajdź okres z najmniejszym SD
    min_j = 0
    min_sd = sds[0]

    for j in range(1, n_cols):
        if sds[j] < min_sd:
            min_sd = sds[j]
            min_j = j

    print("===================================")
    print("NAJMNIEJSZE ODCHYLENIE")
    print("j =", min_j)
    print("dev =", dev_j[min_j])
    print("sd =", min_sd)
    print("===================================")

    # Szczegółowa diagnostyka najmniejszego SD
    for i in range(n_rows):

        w = w_ij[i, min_j]
        p = p_ij[i, min_j]
        l = l_ij[i, min_j]

        if not np.isnan(w) and w > 0:

            diff = l - dev_j[min_j]

            print(
                "i =", i,
                "p =", p,
                "l =", l,
                "w =", w,
                "diff =", diff,
                "skladnik_num =", w * p * diff * diff
            )

    return sigmas, sds
